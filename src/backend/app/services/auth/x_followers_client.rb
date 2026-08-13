require "json"
require "net/http"
require "uri"
require "time"

module Auth
  class XFollowersClient
    class Error < StandardError; end
    class ConfigurationError < Error; end
    class RequestError < Error; end

    Page = Struct.new(:ids, :next_token, keyword_init: true)

    # 応答を返さない相手に当たったとき、呼び出し元のスレッドを無期限に占有させないための上限。
    # Net::HTTP の既定はどちらも無制限で、利用者のリクエストを処理するスレッド上で呼ぶ経路
    # （Auth::ManualFollowerRecheck）ではそのままだと Puma のワーカースレッドが張り付く。
    OPEN_TIMEOUT_SECONDS = 5
    READ_TIMEOUT_SECONDS = 10

    def initialize(
      bearer_token: Rails.configuration.x.follower_cache_sync_bearer_token,
      max_retries: 3
    )
      @bearer_token = bearer_token.to_s.strip
      @max_retries = max_retries

      raise ConfigurationError, "X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN is required" if @bearer_token.empty?
    end

    def fetch_followers_page(user_id:, max_results:, pagination_token: nil)
      uri = URI("https://api.x.com/2/users/#{URI.encode_www_form_component(user_id.to_s)}/followers")
      uri.query = URI.encode_www_form(query_params(max_results:, pagination_token:))

      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer " + bearer_token

      response = perform_request(request, uri)
      payload = JSON.parse(response.body)
      follower_ids = Array(payload.fetch("data")).map { |entry| entry.fetch("id") }
      next_token = payload.fetch("meta", {}).fetch("next_token", nil)

      Page.new(ids: follower_ids, next_token:)
    rescue KeyError => e
      raise RequestError, "X followers response was missing an expected field: #{e.key}"
    rescue JSON::ParserError => e
      raise RequestError, "X followers response was invalid JSON: #{e.message}"
    end

    private

    attr_reader :bearer_token, :max_retries

    def query_params(max_results:, pagination_token:)
      params = { max_results: }
      params[:pagination_token] = pagination_token if pagination_token.present?
      params
    end

    def perform_request(request, uri)
      retries = 0

      loop do
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
        rescue Net::OpenTimeout, Net::ReadTimeout => e
          # 接続確立時のタイムアウトは Net::HTTP.start 自体が投げるため、ブロックの中では
          # 捕まえられない。上限に達したことを X API 側の一時的な障害として扱い、502 に
          # 変換される Auth::XFollowersClient::Error 系へ揃える（素の Net::* だと 500）。
          raise RequestError, "X followers request to #{uri.host} timed out: #{e.class}"
        end

        if response.code == "429" && retries < max_retries
          retries += 1
          wait_seconds = determine_wait_time(response)
          Rails.logger.warn("[Auth::XFollowersClient] HTTP 429 Too Many Requests. Retrying in #{wait_seconds} seconds (Attempt #{retries}/#{max_retries})...")
          sleep(wait_seconds)
          next
        end

        unless response.is_a?(Net::HTTPSuccess)
          raise RequestError, "X followers request to #{uri.host} failed with #{response.code}"
        end

        return response
      end
    end

    def determine_wait_time(response)
      if (reset = response["x-rate-limit-reset"])
        [ reset.to_i - Time.now.to_i, 1 ].max
      elsif (after = response["Retry-After"])
        parse_retry_after(after)
      else
        60
      end
    end

    def parse_retry_after(after)
      after_str = after.to_s.strip
      if after_str.match?(/\A\d+\z/)
        [ after_str.to_i, 1 ].max
      else
        begin
          target_time = Time.httpdate(after_str)
          [ target_time.to_i - Time.now.to_i, 1 ].max
        rescue ArgumentError => e
          Rails.logger.warn("[Auth::XFollowersClient] Failed to parse Retry-After header: #{after_str} (error: #{e.message}). Falling back to 60 seconds.")
          60
        end
      end
    end
  end
end
