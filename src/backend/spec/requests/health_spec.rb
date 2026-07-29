require "rails_helper"

RSpec.describe "Health check", type: :request do
  it "returns ok when the database query succeeds" do
    get "/healthz"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("status" => "ok")
  end

  it "returns service unavailable when the database query fails" do
    allow(ActiveRecord::Base).to receive(:connection).and_raise(ActiveRecord::ConnectionNotEstablished)

    get "/healthz"

    expect(response).to have_http_status(:service_unavailable)
    expect(JSON.parse(response.body)).to eq(
      "status" => "unhealthy",
      "checks" => { "database" => "down" }
    )
  end
end
