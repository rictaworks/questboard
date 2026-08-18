require "rails_helper"

# フロントの開発認証バイパス（questboard/src/components/auth-panel.tsx の isDev 分岐）と
# 対になる、本物のセッションを発行するための開発専用エンドポイント。
#
# 本番からの二重排除：
# 1. config/routes.rb で Rails.env.production? のときはルート自体を定義しない
# 2. app/controllers/dev/ 配下は .dockerignore で本番イメージから物理的に除外される
RSpec.describe "Dev::Session", type: :request do
  it "signs in as a fixed development user and returns an authenticated session" do
    post "/dev/session", as: :json

    expect(response).to have_http_status(:created)
    payload = JSON.parse(response.body)

    expect(payload["authenticated"]).to be(true)
    expect(payload.dig("user", "displayName")).to be_present
    expect(payload.dig("user", "planCode")).to eq("member")
  end

  it "actually sets the session so a subsequent authenticated request succeeds" do
    post "/dev/session", as: :json
    expect(response).to have_http_status(:created)

    get "/session"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)["authenticated"]).to be(true)
  end

  it "reuses the same user across repeated calls instead of creating duplicates" do
    post "/dev/session", as: :json
    first_user_id = JSON.parse(response.body).dig("user", "id")

    post "/dev/session", as: :json
    second_user_id = JSON.parse(response.body).dig("user", "id")

    expect(second_user_id).to eq(first_user_id)
  end
end
