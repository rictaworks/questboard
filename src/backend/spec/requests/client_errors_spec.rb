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
    expect(Rails.logger).to have_received(:error).with(
      hash_including(
        event: "client_error",
        message: "Boom",
        stack: "Error: Boom"
      ).to_json
    )
  end
end
