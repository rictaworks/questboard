module Auth
  class GoogleSessionCreator
    def initialize(
      recaptcha_verifier: RecaptchaVerifier.new,
      google_oauth_client: GoogleOauthClient.new
    )
      @recaptcha_verifier = recaptcha_verifier
      @google_oauth_client = google_oauth_client
    end

    def call(code:, code_verifier:, recaptcha_token:, remote_ip: nil)
      recaptcha_verifier.verify!(token: recaptcha_token, remote_ip:)
      identity = google_oauth_client.exchange_code!(code:, code_verifier:)
      User.upsert_from_google_identity!(google_sub: identity.sub, display_name: identity.display_name)
    end

    private

    attr_reader :recaptcha_verifier, :google_oauth_client
  end
end
