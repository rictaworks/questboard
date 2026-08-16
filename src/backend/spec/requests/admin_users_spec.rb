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

  it "renders the users page without raising when flash messages are absent" do
    get "/admin/users", headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(response.body).to include("手動ログイン許可（例外ユーザー）管理")
  end

  it "redirects back to the users page and shows the validation flash" do
    post "/admin/users", params: { x_user_id: "", display_name: "" }, headers: admin_headers

    expect(response).to redirect_to(admin_users_path)

    get admin_users_path, headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(response.body).to include(I18n.t("admin.users.create.params_missing"))
  end

  it "toggles manual bypass without raising and shows the success flash" do
    user = User.create!(x_user_id: "x-toggle-target", display_name: "Toggle Target")

    patch toggle_bypass_admin_user_path(user), headers: admin_headers

    expect(response).to redirect_to(admin_users_path)
    expect(user.reload.is_manual_member).to be(true)

    get admin_users_path, headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(response.body).to include(I18n.t("admin.users.toggle_bypass.success"))
  end

  it "toggles manual bypass when submitted the way the actual browser button_to form does" do
    # app/views/admin/users/index.html.erb の「ログインを許可」ボタンは
    # button_to ..., method: :patch で描画される。実ブラウザはこれを
    # method="post" のHTMLフォーム + 隠しフィールド _method=patch として送信し、
    # Rack::MethodOverride がそれを読んで PATCH にリライトして初めてルーティングされる。
    # 上のテストのように patch ヘルパーで直接PATCHを発行するとこの経路を検証できない
    # （issue #181で報告された、request specはgreenなのに実ブラウザでは反映されない
    # 乖離の原因）。
    user = User.create!(x_user_id: "x-toggle-target-browser", display_name: "Toggle Target Browser")

    post toggle_bypass_admin_user_path(user), params: { _method: "patch" }, headers: admin_headers

    expect(response).to redirect_to(admin_users_path)
    expect(user.reload.is_manual_member).to be(true)
  end

  private

  def admin_headers
    {
      "Authorization" => ActionController::HttpAuthentication::Basic.encode_credentials("admin", "secret")
    }
  end
end
