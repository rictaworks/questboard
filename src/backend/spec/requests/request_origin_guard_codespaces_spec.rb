require "rails_helper"

# フロント側の動的backend URL解決（questboard/src/lib/backend-url.ts）と対になる、
# バックエンド側のオリジン許可。development環境でCODESPACE_NAME /
# CODESPACES_FORWARDING_DOMAIN が両方設定されているとき、Codespacesの転送URL越しに
# 開いたフロントからのオリジンを RequestOriginGuard と Rack::Cors の両方が許可すること。
RSpec.describe "RequestOriginGuard (Codespaces forwarded origin)", type: :request do
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let(:owner) { User.create!(x_user_id: "x-sub-owner", display_name: "Owner User", plan: member_plan) }
  let(:session_creator) { instance_double(Auth::XSessionCreator) }

  around do |example|
    original_codespace_name = ENV["CODESPACE_NAME"]
    original_forwarding_domain = ENV["CODESPACES_FORWARDING_DOMAIN"]

    ENV["CODESPACE_NAME"] = "curly-journey-gxq7gpgxwwj73j6w"
    ENV["CODESPACES_FORWARDING_DOMAIN"] = "app.github.dev"

    example.run
  ensure
    ENV["CODESPACE_NAME"] = original_codespace_name
    ENV["CODESPACES_FORWARDING_DOMAIN"] = original_forwarding_domain
  end

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
    sign_in(owner)
  end

  it "allows a POST from the Codespaces-forwarded frontend origin" do
    post "/boards",
      params: { title: "Codespaces Board" },
      headers: { "HTTP_ORIGIN" => "https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev" },
      as: :json

    expect(response).to have_http_status(:created)
  end

  it "echoes the forwarded origin back on CORS preflight" do
    process :options, "/boards", headers: {
      "HTTP_ORIGIN" => "https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev",
      "HTTP_ACCESS_CONTROL_REQUEST_METHOD" => "POST"
    }

    expect(response).to have_http_status(:ok)
    expect(response.headers["Access-Control-Allow-Origin"])
      .to eq("https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev")
  end

  it "still rejects a different codespace's forwarded origin" do
    post "/boards",
      params: { title: "Codespaces Board" },
      headers: { "HTTP_ORIGIN" => "https://someone-elses-codespace-3100.app.github.dev" },
      as: :json

    expect(response).to have_http_status(:forbidden)
  end
end
