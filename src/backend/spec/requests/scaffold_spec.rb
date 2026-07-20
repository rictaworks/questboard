require "rails_helper"

RSpec.describe "Backend scaffold", type: :request do
  around do |example|
    original_username = ENV["ADMIN_BASIC_AUTH_USERNAME"]
    original_password = ENV["ADMIN_BASIC_AUTH_PASSWORD"]

    ENV["ADMIN_BASIC_AUTH_USERNAME"] = "admin"
    ENV["ADMIN_BASIC_AUTH_PASSWORD"] = "secret"

    example.run
  ensure
    ENV["ADMIN_BASIC_AUTH_USERNAME"] = original_username
    ENV["ADMIN_BASIC_AUTH_PASSWORD"] = original_password
  end

  it "returns a health check response" do
    get "/healthz"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("status" => "ok")
  end

  it "requires basic auth for the admin namespace" do
    get "/admin"

    expect(response).to have_http_status(:unauthorized)

    credentials = ActionController::HttpAuthentication::Basic.encode_credentials("admin", "secret")
    get "/admin", headers: {"Authorization" => credentials}

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("status" => "ok", "area" => "admin")
  end
end
