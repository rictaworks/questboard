require "rails_helper"

RSpec.describe Admin::UsersController, type: :controller do
  render_views

  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }

  before do
    ENV["ADMIN_BASIC_AUTH_USERNAME"] = "admin"
    ENV["ADMIN_BASIC_AUTH_PASSWORD"] = "secret"
    request.env["HTTP_AUTHORIZATION"] =
      ActionController::HttpAuthentication::Basic.encode_credentials("admin", "secret")
  end

  describe "GET #index" do
    it "lists users with their plan" do
      User.create!(x_user_id: "x-1", display_name: "Ada Lovelace", plan: member_plan)

      get :index

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("Ada Lovelace")
    end

    it "limits the listing to 50 users" do
      55.times { |i| User.create!(x_user_id: "x-limit-#{i}", display_name: "User #{i}", plan: none_plan) }

      get :index

      expect(assigns(:users).size).to eq(50)
    end

    it "filters users by the search term" do
      User.create!(x_user_id: "search-target", display_name: "Target", plan: none_plan)
      User.create!(x_user_id: "search-other", display_name: "Other", plan: none_plan)

      get :index, params: { search_user: "search-target" }

      expect(assigns(:users).map(&:x_user_id)).to eq([ "search-target" ])
    end

    # 救済は判定サービス（x-follower-gate）のオーバーライドへ一本化した。
    # questboard 側に例外指定の入口が戻っていないことを固定する。
    it "offers no way to grant access from questboard itself" do
      get :index

      expect(response.body).not_to include("手動許可")
      expect(response.body).not_to include("ログインを許可")
    end
  end
end
