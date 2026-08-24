module Auth
  class XSessionCreator
    def initialize(
      recaptcha_verifier: RecaptchaVerifier.new,
      x_oauth_client: XOauthClient.new,
      follower_gate: FollowerGate.new
    )
      @recaptcha_verifier = recaptcha_verifier
      @x_oauth_client = x_oauth_client
      @follower_gate = follower_gate
    end

    def call(code:, code_verifier:, recaptcha_token:, remote_ip: nil)
      recaptcha_verifier.verify!(token: recaptcha_token, remote_ip:)
      identity = x_oauth_client.exchange_code!(code:, code_verifier:)
      resolution = resolve_plan(identity.id)

      User.upsert_from_x_identity!(
        x_user_id: identity.id,
        display_name: identity.display_name,
        plan: resolution&.plan,
        confirmed: resolution&.confirmed || false
      )
    end

    private

    attr_reader :recaptcha_verifier, :x_oauth_client, :follower_gate

    # 判定サービスへ到達できなかった場合、**ログインを失敗させない**（設計書 4.3
    # 「ログインを拒否する分岐は設けない」）。プラン値は User.upsert_from_x_identity! が
    # 据え置く。ここで none を組み立てて返すと、判定できていない状態が
    # 「拒否された」として既存の member を巻き込む。
    def resolve_plan(x_user_id)
      follower_gate.resolve(x_user_id)
    rescue FollowerGateClient::Error => e
      Rails.logger.error("[#{self.class.name}] #{e.class}: #{e.message}")
      nil
    end
  end
end
