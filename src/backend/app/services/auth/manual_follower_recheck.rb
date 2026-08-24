module Auth
  # 手動再判定をフォロワー判定サービス（x-follower-gate）へ委譲する（Issue #253）。
  #
  # **X API を直接呼ばない。クールダウンも持たない。** 多重要求の抑止は判定サービスが
  # 利用者単位・資格情報単位で行う（x-follower-gate requirements.md 第11章）。
  # 同じ制限を questboard 側にも置くと、待機の残り時間が2系統に分かれ、
  # 画面に出す値と実際に受理される時刻が食い違う。
  #
  # 利用者向けフォームのボット対策は利用側アプリの責務なので（12.4）、
  # questboard 側の reCAPTCHA はそのまま残す。
  class ManualFollowerRecheck
    # 判定サービスが待機と判断した。retry_after は再要求可能となる時刻（JST文字列）で、
    # 判定サービスが返した値をそのまま持つ。こちらで残り秒数へ読み替えない。
    class ThrottledError < StandardError
      attr_reader :retry_after

      def initialize(retry_after:)
        @retry_after = retry_after
        super("follower gate throttled the recheck request")
      end
    end

    def initialize(
      user:,
      client: FollowerGateClient.new,
      follower_gate: FollowerGate.new
    )
      @user = user
      @client = client
      @follower_gate = follower_gate
    end

    def call
      result = client.request_recheck(user.x_user_id)

      raise ThrottledError.new(retry_after: result.retry_after) if result.result == FollowerGateClient::RESULT_THROTTLED

      previous_plan_code = user.plan&.code
      resolved_plan = Plan.find_or_create_by_code!(
        FollowerGate::PLAN_CODE_BY_GATE_PLAN.fetch(result.plan)
      )
      user.update!(plan: resolved_plan)

      # プラン値はアクセス制御の根拠（ApplicationController#require_feature_plan!）であり、
      # 誰がいつ変えたかは監査・調査の対象になる。判定根拠は判定サービス側の記録に残るため、
      # ここには残さない。
      Rails.logger.info(
        "[#{self.class.name}] x_user_id=#{user.x_user_id} " \
        "plan: #{previous_plan_code} -> #{resolved_plan.code}"
      )

      user.reload
    end

    private

    attr_reader :user, :client, :follower_gate
  end
end
