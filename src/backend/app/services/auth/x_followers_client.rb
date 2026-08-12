require "json"
require "net/http"
require "uri"

module Auth
  class XFollowersClient
    class Error < StandardError; end
    class ConfigurationError < Error; end
    class RequestError < Error; end

    Page = Struct.new(:ids, :next_token, keyword_init: true)

    def initialize(bearer_token: Rails.configuration.x.follower_cache_sync_bearer_token)
      @bearer_token = bearer_token.to_s.strip

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

    attr_reader :bearer_token

    def query_params(max_results:, pagination_token:)
      params = { max_results: }
      params[:pagination_token] = pagination_token if pagination_token.present?
      params
    end

    def perform_request(request, uri)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
        http.request(request)
      end

      unless response.is_a?(Net::HTTPSuccess)
        raise RequestError, "X followers request to #{uri.host} failed with #{response.code}"
      end

      response
    end
  end
end
