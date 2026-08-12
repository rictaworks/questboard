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
      plan = follower_gate.resolve_plan(identity.id)
      User.upsert_from_x_identity!(x_user_id: identity.id, display_name: identity.display_name, plan:)
    end

    private

    attr_reader :recaptcha_verifier, :x_oauth_client, :follower_gate
  end
end
