require "rails_helper"

RSpec.describe "Client errors", type: :request do
  it "accepts client error reports" do
    allow(Rails.logger).to receive(:error)

    post "/client_errors", params: {
      message: "Boom",
      stack: "Error: Boom",
      source: "https://app.example.test/page",
      url: "https://app.example.test/page",
      line: 12,
      column: 34,
      user_agent: "RSpec"
    }, as: :json

    expect(response).to have_http_status(:no_content)
    expect(Rails.logger).to have_received(:error) do |arg|
      json = JSON.parse(arg)
      expect(json).to include(
        "event" => "client_error",
        "message" => "Boom",
        "stack" => "Error: Boom",
        "source" => "https://app.example.test/page",
        "url" => "https://app.example.test/page",
        "line" => 12,
        "column" => 34,
        "user_agent" => "RSpec"
      )
    end
  end

  it "sanitizes the url in the logged payload to mask board share tokens and strip queries" do
    allow(Rails.logger).to receive(:error)

    post "/client_errors", params: {
      message: "Boom",
      url: "https://app.example.test/ja/b/secret-share-token-123?auth=true#section"
    }, as: :json

    expect(response).to have_http_status(:no_content)
    expect(Rails.logger).to have_received(:error) do |arg|
      json = JSON.parse(arg)
      expect(json["url"]).to eq("https://app.example.test/ja/b/[redacted]")
      expect(json["url"]).not_to include("secret-share-token-123")
      expect(json["url"]).not_to include("auth=true")
    end
  end

  it "sanitizes invalid URLs by stripping queries/fragments and masking board share tokens" do
    allow(Rails.logger).to receive(:error)

    post "/client_errors", params: {
      message: "Boom",
      url: "https://example.test/%zz/b/secret-share-token-123?auth=secret#token"
    }, as: :json

    expect(response).to have_http_status(:no_content)
    expect(Rails.logger).to have_received(:error) do |arg|
      json = JSON.parse(arg)
      expect(json["url"]).to eq("https://example.test/%zz/b/[redacted]")
      expect(json["url"]).not_to include("secret-share-token-123")
      expect(json["url"]).not_to include("auth=secret")
      expect(json["url"]).not_to include("token")
    end
  end

  it "filters sensitive url parameter in Rails parameter logging" do
    logged_info = []
    allow(Rails.logger).to receive(:info) { |message| logged_info << message }

    post "/client_errors", params: {
      message: "Boom",
      url: "https://app.example.test/ja/b/secret-share-token-999?auth=danger#section"
    }, as: :json

    expect(response).to have_http_status(:no_content)
    param_logs = logged_info.grep(/Parameters:/)
    expect(param_logs).not_to be_empty

    param_log_str = param_logs.join("\n")
    expect(param_log_str).to include("https://app.example.test/ja/b/[redacted]")
    expect(param_log_str).not_to include("secret-share-token-999")
    expect(param_log_str).not_to include("auth=danger")
  end

  it "handles URLs truncated at a multibyte character boundary without raising ArgumentError" do
    allow(Rails.logger).to receive(:error)

    # "https://app.example.test/b/token/" is 33 bytes.
    # We want prefix to be 2047 bytes, so we add 2014 "a"s.
    # "é" is \xC3\xA9 in UTF-8 (2 bytes).
    # prefix + "é" will be 2049 bytes total.
    # Truncation at 2048 bytes will split "é" into \xC3, producing invalid UTF-8.
    prefix = "https://app.example.test/b/token/" + ("a" * 2014)
    multibyte_url = prefix + "é"

    post "/client_errors", params: {
      message: "Multibyte boundary error",
      url: multibyte_url
    }, as: :json

    expect(response).to have_http_status(:no_content)
    expect(Rails.logger).to have_received(:error) do |arg|
      json = JSON.parse(arg)
      expect(json["url"]).to eq("https://app.example.test/b/[redacted]/" + ("a" * 2014))
    end
  end

  it "rejects request bodies exceeding 24KB" do
    large_payload = "a" * (25 * 1024)

    # 1. When Content-Length is explicitly set
    post "/client_errors",
         params: large_payload,
         headers: { "CONTENT_TYPE" => "application/json", "CONTENT_LENGTH" => large_payload.bytesize.to_s }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)

    # 2. When Content-Length is missing (or simulated via chunked encoding)
    post "/client_errors",
         params: large_payload,
         headers: { "CONTENT_TYPE" => "application/json", "HTTP_TRANSFER_ENCODING" => "chunked" }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)

    # 3. When URL path has a format suffix (e.g., .json)
    post "/client_errors.json",
         params: large_payload,
         headers: { "CONTENT_TYPE" => "application/json", "CONTENT_LENGTH" => large_payload.bytesize.to_s }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)
  end

  it "accepts request bodies where all fields are at their maximum limit" do
    allow(Rails.logger).to receive(:error)

    # Individual capacities:
    # stack: 8192 bytes, message/source/url/user_agent: 2048 bytes
    # total fields = 16384 bytes, which is greater than 16KB but below 24KB.
    max_payload = {
      message: "a" * 2048,
      stack: "a" * 8192,
      source: "a" * 2048,
      url: "https://app.example.test/b/" + ("a" * (2048 - 29)),
      user_agent: "a" * 2048,
      line: 12345,
      column: 67890
    }

    post "/client_errors", params: max_payload, as: :json

    expect(response).to have_http_status(:no_content)
    expect(Rails.logger).to have_received(:error) do |arg|
      json = JSON.parse(arg)
      expect(json["message"].bytesize).to eq(2048)
      expect(json["stack"].bytesize).to eq(8192)
      expect(json["source"].bytesize).to eq(2048)
      expect(json["url"]).to start_with("https://app.example.test/b/[redacted]")
      expect(json["user_agent"].bytesize).to eq(2048)
    end
  end

  describe "rate limiting" do
    let(:memory_store) { ActiveSupport::Cache.lookup_store(:memory_store) }

    before do
      allow(Rails).to receive(:cache).and_return(memory_store)
      Rails.cache.clear
      @original_base_perform_caching = ActionController::Base.perform_caching
      @original_api_perform_caching = ActionController::API.perform_caching
      ActionController::Base.perform_caching = true
      ActionController::API.perform_caching = true
    end

    after do
      ActionController::Base.perform_caching = @original_base_perform_caching
      ActionController::API.perform_caching = @original_api_perform_caching
    end

    it "limits requests to 10 per minute per IP" do
      10.times do
        post "/client_errors", params: { message: "Boom" }, as: :json, headers: { "REMOTE_ADDR" => "1.2.3.4" }
        expect(response).to have_http_status(:no_content)
      end

      post "/client_errors", params: { message: "Boom" }, as: :json, headers: { "REMOTE_ADDR" => "1.2.3.4" }
      expect(response).to have_http_status(:too_many_requests)
    end
  end
end
