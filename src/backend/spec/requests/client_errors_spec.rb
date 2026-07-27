require "rails_helper"

RSpec.describe "Client errors", type: :request do
  let(:client_error_headers) { { "REMOTE_ADDR" => "203.0.113.10" } }

  it "accepts client error reports and redacts share tokens from URLs" do
    expect(Rails.logger).to receive(:error) do |entry|
      payload = JSON.parse(entry)
      expect(payload).to include(
        "column" => 34,
        "event" => "client_error",
        "line" => 12,
        "message" => "Boom",
        "source" => "https://app.example.test/page",
        "stack" => "Error: Boom",
        "url" => "/ja/b/[redacted]",
        "user_agent" => "RSpec"
      )
      expect(payload["url"]).not_to include("share-secret-123")
      expect(payload["url"]).not_to include("token=abc123")
      expect(payload["url"]).not_to include("code=oauth-code")
    end

    post "/client_errors", params: {
      column: 34,
      line: 12,
      message: "Boom",
      source: "https://app.example.test/page",
      stack: "Error: Boom",
      url: "https://app.example.test/ja/b/share-secret-123?token=abc123&code=oauth-code#fragment",
      user_agent: "RSpec"
    }, as: :json

    expect(response).to have_http_status(:no_content)
  end

  it "rejects request bodies exceeding 20KB, even when Content-Length is missing or chunked" do
    large_payload = "a" * (20 * 1024 + 1)

    post "/client_errors",
         params: large_payload,
         headers: {
           "CONTENT_LENGTH" => large_payload.bytesize.to_s,
           "CONTENT_TYPE" => "application/json"
         }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)

    post "/client_errors",
         params: large_payload,
         headers: {
           "CONTENT_TYPE" => "application/json",
           "HTTP_TRANSFER_ENCODING" => "chunked"
         }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)
  end

  it "rate limits repeated reports from the same IP" do
    allow(Rails.logger).to receive(:error)

    20.times do
      post "/client_errors", params: {
        message: "Boom",
        source: "https://app.example.test/page",
        url: "https://app.example.test/page"
      }, as: :json, headers: client_error_headers

      expect(response).to have_http_status(:no_content)
    end

    post "/client_errors", params: {
      message: "Boom",
      source: "https://app.example.test/page",
      url: "https://app.example.test/page"
    }, as: :json, headers: client_error_headers

    expect(response).to have_http_status(:too_many_requests)
  end
end
