require "rails_helper"

RSpec.describe "Admin users", type: :request do
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

  it "renders the users page" do
    get "/admin/users", headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(response.body).to include("利用者一覧")
  end

  it "requires basic authentication" do
    get "/admin/users"

    expect(response).to have_http_status(:unauthorized)
  end

  # 救済は判定サービス側で行う。questboard 側に例外指定の経路が残っていると、
  # 運用者がどちらを見ればよいか分からなくなる。
  it "no longer exposes the manual bypass route" do
    user = User.create!(x_user_id: "x-toggle-target", display_name: "Toggle Target")

    expect { patch "/admin/users/#{user.id}/toggle_bypass", headers: admin_headers }
      .to raise_error(ActionController::RoutingError)
  end

  it "no longer accepts user creation from the admin screen" do
    expect { post "/admin/users", params: { x_user_id: "x-created", display_name: "Created" }, headers: admin_headers }
      .to raise_error(ActionController::RoutingError)
  end

  private

  def admin_headers
    {
      "Authorization" => ActionController::HttpAuthentication::Basic.encode_credentials("admin", "secret")
    }
  end
end
