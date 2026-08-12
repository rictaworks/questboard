module Auth
  class XSessionCreator
    def initialize(
      recaptcha_verifier: RecaptchaVerifier.new,
      x_oauth_client: XOauthClient.new
    )
      @recaptcha_verifier = recaptcha_verifier
      @x_oauth_client = x_oauth_client
    end

    def call(code:, code_verifier:, recaptcha_token:, remote_ip: nil)
      recaptcha_verifier.verify!(token: recaptcha_token, remote_ip:)
      identity = x_oauth_client.exchange_code!(code:, code_verifier:)
      User.upsert_from_x_identity!(x_user_id: identity.id, display_name: identity.display_name)
    end

    private

    attr_reader :recaptcha_verifier, :x_oauth_client
  end
end
