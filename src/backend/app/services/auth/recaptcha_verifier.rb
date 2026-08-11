require "json"
require "net/http"
require "uri"

module Auth
  class RecaptchaVerifier
    class Error < StandardError; end

    VERIFY_ENDPOINT = URI("https://www.google.com/recaptcha/api/siteverify")

    DEFAULT_MIN_SCORE = 0.5
    DEFAULT_EXPECTED_ACTION = "login"

    def initialize(secret_key: ENV["RECAPTCHA_SECRET_KEY"])
      @secret_key = secret_key.to_s.strip
      raise Error, "RECAPTCHA_SECRET_KEY is required" if @secret_key.empty?
    end

    def verify!(token:, expected_action: DEFAULT_EXPECTED_ACTION, min_score: DEFAULT_MIN_SCORE, remote_ip: nil)
      request = Net::HTTP::Post.new(VERIFY_ENDPOINT)
      request.set_form_data({
        secret: secret_key,
        response: token,
        remoteip: remote_ip
      }.compact)

      response = Net::HTTP.start(VERIFY_ENDPOINT.host, VERIFY_ENDPOINT.port, use_ssl: true) do |http|
        http.request(request)
      end

      unless response.is_a?(Net::HTTPSuccess)
        raise Error, "reCAPTCHA request failed with #{response.code}"
      end

      payload = JSON.parse(response.body)
      raise Error, "reCAPTCHA verification failed" unless payload["success"] == true

      if expected_action && payload["action"] != expected_action
        raise Error, "reCAPTCHA action mismatch"
      end

      score = payload["score"].to_f
      if min_score && score < min_score.to_f
        raise Error, "reCAPTCHA score too low"
      end

      true
    rescue JSON::ParserError => e
      raise Error, "reCAPTCHA response was invalid JSON: #{e.message}"
    end

    private

    attr_reader :secret_key
  end
end
