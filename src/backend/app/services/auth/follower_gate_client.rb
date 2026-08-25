require "json"
require "net/http"
require "uri"

module Auth
  # フォロワー判定サービス（x-follower-gate）の内部APIへ接続する（Issue #253）。
  #
  # **判定は questboard では行わない。** 入力は数値ユーザーIDで、出力はプラン値のみを受け取る。
  # フォロワー集合・判定根拠は返らないため、こちら側で再解釈する余地を持たない
  # （x-follower-gate requirements.md 4.3・第13章）。
  #
  # **資格情報は例外メッセージにもログにも出さない。** 接続先・応答本文をそのまま
  # 記録すると、Authorization ヘッダや照会対象のIDがログへ流れる。
  class FollowerGateClient
    class Error < StandardError; end
    class ConfigurationError < Error; end
    # 判定サービスへ到達できなかった、または応答が想定と異なる。
    # **「拒否」と混同してはならない。** 既定値へ倒すと、判定できていない状態が
    # 拒否として利用者に見える（x-follower-gate の reference-app と同じ方針）。
    class RequestError < Error; end

    # 応答を返さない相手に当たったとき、呼び出し元のスレッドを無期限に占有させないための上限。
    # 判定は利用者のログイン処理・再判定処理のスレッド上で同期実行されるため、
    # Net::HTTP の既定（無制限）のままだと Puma のワーカースレッドが張り付く。
    OPEN_TIMEOUT_SECONDS = 5
    READ_TIMEOUT_SECONDS = 10

    # 判定サービスが返すプラン値（x-follower-gate SPEC/api/decision.md）。
    # questboard 内部のプラン値（member / none）とは別の語彙であり、変換は Auth::FollowerGate が担う。
    PLAN_FULL = "full"
    PLAN_RESTRICTED = "restricted"
    PLANS = [ PLAN_FULL, PLAN_RESTRICTED ].freeze

    # 手動再判定の結果（x-follower-gate SPEC/api/recheck.md）。
    RESULT_ACCEPTED = "accepted"
    RESULT_THROTTLED = "throttled"
    RESULTS = [ RESULT_ACCEPTED, RESULT_THROTTLED ].freeze

    # 判定サービスは待機を 429 で返す（x-follower-gate の Internal::RechecksController#status_for）。
    # **待機は失敗ではない。** 2xx 以外を一律で障害として扱うと、正常な待機が
    # 「判定サービスの障害」に化け、利用者へ再要求可能時刻を示せなくなる。
    THROTTLED_STATUS_CODE = "429".freeze

    Decision = Struct.new(:plan, :decided_at, :recheck_available, :inquiry_id, :confirmed, keyword_init: true)
    RecheckResult = Struct.new(:result, :retry_after, :plan, :inquiry_id, keyword_init: true)

    def initialize(
      base_url: Rails.configuration.x.follower_gate_base_url,
      client_id: Rails.configuration.x.follower_gate_client_id,
      credential: Rails.configuration.x.follower_gate_credential
    )
      @base_url = base_url.to_s.strip
      @client_id = client_id.to_s.strip
      @credential = credential.to_s.strip

      raise ConfigurationError, "X_FOLLOWER_GATE_BASE_URL is required" if @base_url.empty?
      raise ConfigurationError, "X_FOLLOWER_GATE_CLIENT_ID is required" if @client_id.empty?
      raise ConfigurationError, "X_FOLLOWER_GATE_CREDENTIAL is required" if @credential.empty?
    end

    def fetch_decision(x_user_id)
      uri = build_uri("/internal/decision")
      uri.query = URI.encode_www_form(x_user_id: x_user_id.to_s)

      payload = perform(Net::HTTP::Get.new(uri), uri)

      Decision.new(
        plan: fetch_plan(payload),
        decided_at: payload["decided_at"],
        recheck_available: payload["recheck_available"] == true,
        inquiry_id: fetch_inquiry_id(payload, x_user_id),
        confirmed: payload["confirmed"] == true
      )
    end

    def request_recheck(x_user_id)
      uri = build_uri("/internal/recheck")
      request = Net::HTTP::Post.new(uri)
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(x_user_id: x_user_id.to_s)

      payload = perform(request, uri, accept_status_codes: [ THROTTLED_STATUS_CODE ])
      result = payload["result"]

      unless RESULTS.include?(result)
        raise RequestError, "follower gate recheck returned an unexpected result"
      end

      RecheckResult.new(
        result: result,
        retry_after: payload["retry_after"],
        # 待機した場合、プラン値は返らない（recheck.md）。受理した場合のみ検証する。
        plan: result == RESULT_ACCEPTED ? fetch_plan(payload) : nil,
        inquiry_id: fetch_inquiry_id(payload, x_user_id)
      )
    end

    private

    attr_reader :base_url, :client_id, :credential

    def build_uri(path)
      URI.join(base_url, path)
    rescue URI::InvalidURIError, URI::BadURIError => e
      raise ConfigurationError, "X_FOLLOWER_GATE_BASE_URL is not a valid URL: #{e.class}"
    end

    # 応答が想定と異なる場合、既定値へ倒さずに例外にする。
    # 「判定できていない」と「拒否された」を混同しないため（要件1）。
    def fetch_plan(payload)
      plan = payload["plan"]
      raise RequestError, "follower gate returned an unexpected plan" unless PLANS.include?(plan)

      plan
    end

    # 照会用の値は判定に用いる数値ユーザーIDそのもの（x-follower-gate requirements.md 第13章）。
    # 前提が崩れたら記録に残す。黙って読み替えると、拒否された利用者が申告した値で
    # 運用者がオーバーライドを登録できなくなる。
    def fetch_inquiry_id(payload, x_user_id)
      inquiry_id = payload["inquiry_id"]
      raise RequestError, "follower gate returned no inquiry id" unless inquiry_id.is_a?(String) && inquiry_id.present?

      if inquiry_id != x_user_id.to_s
        Rails.logger.warn("[#{self.class.name}] inquiry id did not match the requested x_user_id")
      end

      inquiry_id
    end

    # accept_status_codes には、成功ではないが本文を読むべき応答の状態コードを渡す。
    # 資格情報の照合失敗による 429 も同じ状態コードで返るが、その本文は
    # 待機の形をしていないため、呼び出し側の検証で弾かれて障害として扱われる。
    def perform(request, uri, accept_status_codes: [])
      request["Authorization"] = "Bearer #{client_id}:#{credential}"

      response = begin
        Net::HTTP.start(
          uri.host,
          uri.port,
          use_ssl: uri.scheme == "https",
          open_timeout: OPEN_TIMEOUT_SECONDS,
          read_timeout: READ_TIMEOUT_SECONDS
        ) do |http|
          http.request(request)
        end
      rescue Net::OpenTimeout, Net::ReadTimeout, Net::WriteTimeout => e
        raise RequestError, "follower gate request to #{uri.host} timed out: #{e.class}"
      rescue SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError,
             Net::ProtocolError, Net::HTTPBadResponse => e
        # 接続の失敗をそのまま外へ出すと 500 になる。上流の障害として 502 へ倒すため
        # RequestError へ揃える。
        #
        # SocketError は名前解決の失敗（Socket::ResolutionError）を含む。これが漏れると、
        # 判定サービスのホスト名が引けない状況でログインそのものが 500 になる（#263）。
        # Net::HTTPBadResponse は Net::ProtocolError の子ではないため別に挙げる。
        raise RequestError, "follower gate request to #{uri.host} failed: #{e.class}"
      end

      unless response.is_a?(Net::HTTPSuccess) || accept_status_codes.include?(response.code)
        # **応答本文をメッセージへ含めない。** 資格情報の誤りを示す本文がログへ流れる。
        raise RequestError, "follower gate request failed with #{response.code}"
      end

      begin
        JSON.parse(response.body.to_s)
      rescue JSON::ParserError
        raise RequestError, "follower gate response was invalid JSON"
      end
    end
  end
end
