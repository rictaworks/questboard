require "json"
require "net/http"
require "uri"

module Auth
  class XOauthClient
    class Error < StandardError; end
    class ConfigurationError < Error; end
    class RequestError < Error; end

    Identity = Struct.new(:id, :display_name, keyword_init: true)

    TOKEN_ENDPOINT = URI("https://api.x.com/2/oauth2/token")
    USERINFO_ENDPOINT = URI("https://api.x.com/2/users/me")

    def initialize(
      client_id: ENV["X_OAUTH_CLIENT_ID"],
      redirect_uri: ENV["X_OAUTH_REDIRECT_URI"]
    )
      @client_id = client_id.to_s.strip
      @redirect_uri = redirect_uri.to_s.strip

      raise ConfigurationError, "X OAuth configuration is incomplete" if [ @client_id, @redirect_uri ].any?(&:empty?)
    end

    def exchange_code!(code:, code_verifier:)
      token_payload = post_form(TOKEN_ENDPOINT, token_form(code:, code_verifier:))
      user_info = fetch_user_info(token_payload.fetch("access_token"))

      Identity.new(
       id: user_info.fetch("data").fetch("id"),
       display_name: user_info.fetch("data").fetch("name")
      )
    rescue KeyError => e
      raise RequestError, "X OAuth response was missing an expected field: #{e.key}"
    end

    private

    attr_reader :client_id, :redirect_uri

    def token_form(code:, code_verifier:)
      {
       client_id:,
       code:,
       code_verifier:,
       grant_type: "authorization_code",
       redirect_uri:
      }
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
        raise RequestError, "X OAuth request to #{uri.host} failed with #{response.code}"
      end

      JSON.parse(response.body)
    rescue JSON::ParserError => e
      raise RequestError, "X OAuth response from #{uri.host} was invalid JSON: #{e.message}"
    end
  end
end
