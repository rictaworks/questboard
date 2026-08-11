require "json"
require "net/http"
require "uri"

module Auth
  class GoogleOauthClient
    class Error < StandardError; end
    class ConfigurationError < Error; end
    class RequestError < Error; end

    Identity = Struct.new(:sub, :display_name, keyword_init: true)

    TOKEN_ENDPOINT = URI("https://oauth2.googleapis.com/token")
    TOKEN_INFO_ENDPOINT = URI("https://oauth2.googleapis.com/tokeninfo")
    USERINFO_ENDPOINT = URI("https://openidconnect.googleapis.com/v1/userinfo")
    EXPECTED_ISSUERS = %w[https://accounts.google.com accounts.google.com].freeze

    def initialize(
      client_id: ENV["GOOGLE_OAUTH_CLIENT_ID"],
      client_secret: ENV["GOOGLE_OAUTH_CLIENT_SECRET"],
      redirect_uri: ENV["GOOGLE_OAUTH_REDIRECT_URI"]
    )
      @client_id = client_id.to_s.strip
      @client_secret = client_secret.to_s.strip
      @redirect_uri = redirect_uri.to_s.strip

      raise ConfigurationError, "Google OAuth configuration is incomplete" if [ @client_id, @client_secret, @redirect_uri ].any?(&:empty?)
    end

    def exchange_code!(code:, code_verifier:)
      token_payload = post_form(TOKEN_ENDPOINT, token_form(code:, code_verifier:))
      token_info = fetch_token_info(token_payload.fetch("id_token"))
      user_info = fetch_user_info(token_payload.fetch("access_token"))

      validate_token_info!(token_info)

      Identity.new(
        sub: token_info.fetch("sub"),
        display_name: user_info.fetch("name", nil) || user_info.fetch("email")
      )
    rescue KeyError => e
      raise RequestError, "Google OAuth response was missing an expected field: #{e.key}"
    end

    private

    attr_reader :client_id, :client_secret, :redirect_uri

    def token_form(code:, code_verifier:)
      {
        client_id:,
        client_secret:,
        code:,
        code_verifier:,
        grant_type: "authorization_code",
        redirect_uri:
      }
    end

    def fetch_token_info(id_token)
      uri = TOKEN_INFO_ENDPOINT.dup
      uri.query = URI.encode_www_form(id_token:)
      get_json(uri)
    end

    def fetch_user_info(access_token)
      uri = USERINFO_ENDPOINT.dup
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer " + access_token
      parse_json_response(request, uri)
    end

    def post_form(uri, form)
      request = Net::HTTP::Post.new(uri)
      request.set_form_data(form.compact)
      parse_json_response(request, uri)
    end

    def get_json(uri)
      request = Net::HTTP::Get.new(uri)
      parse_json_response(request, uri)
    end

    def parse_json_response(request, uri)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
        http.request(request)
      end

      unless response.is_a?(Net::HTTPSuccess)
        raise RequestError, "Google OAuth request to #{uri.host} failed with #{response.code}"
      end

      JSON.parse(response.body)
    rescue JSON::ParserError => e
      raise RequestError, "Google OAuth response from #{uri.host} was invalid JSON: #{e.message}"
    end

    def validate_token_info!(token_info)
      issuer = token_info.fetch("iss")
      audience = token_info.fetch("aud")
      expires_at = token_info.fetch("exp").to_i

      raise RequestError, "Google token issuer is invalid" unless EXPECTED_ISSUERS.include?(issuer)
      raise RequestError, "Google token audience is invalid" unless audience == client_id
      raise RequestError, "Google token is expired" if expires_at <= Time.now.to_i
    end
  end
end
