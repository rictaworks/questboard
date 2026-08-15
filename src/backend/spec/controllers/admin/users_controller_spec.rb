require "rails_helper"

RSpec.describe Admin::UsersController, type: :controller do
  let!(:member_plan) { Plan.find_by(code: "member") || Plan.create!(code: "member") }
  let!(:none_plan) { Plan.find_by(code: "none") || Plan.create!(code: "none") }

  before do
    stub_const("ENV", ENV.to_h.merge(
      "ADMIN_BASIC_AUTH_USERNAME" => "admin",
      "ADMIN_BASIC_AUTH_PASSWORD" => "password"
    ))
    request.env["HTTP_AUTHORIZATION"] = ActionController::HttpAuthentication::Basic.encode_credentials("admin", "password")
    allow(controller).to receive(:verify_authenticity_token)
  end

  describe "GET #index" do
    it "returns HTTP success and lists users and follower caches" do
      user = User.create!(x_user_id: "x-1", display_name: "Follower", plan: member_plan)
      cache = FollowerCache.create!(x_user_id: "x-1", fetched_at: Time.current)
      get :index

      expect(response).to have_http_status(:success)
      expect(controller.instance_variable_get(:@users)).to include(user)
      expect(controller.instance_variable_get(:@follower_caches)).to include(cache)
    end

    it "self-heals missing member and none plans" do
      UserQuest.delete_all
      User.delete_all
      Plan.where(code: %w[member none]).delete_all

      get :index

      expect(response).to have_http_status(:success)
      expect(Plan.find_by(code: "member")).to be_present
      expect(Plan.find_by(code: "none")).to be_present
    end

    it "limits users and follower caches lists to 50 records" do
      55.times do |i|
        User.create!(x_user_id: "x-limit-#{i}", display_name: "User #{i}", plan: none_plan)
        FollowerCache.create!(x_user_id: "x-limit-#{i}", fetched_at: Time.current)
      end

      get :index

      expect(controller.instance_variable_get(:@users).size).to eq(50)
      expect(controller.instance_variable_get(:@follower_caches).size).to eq(50)
    end

    it "filters users list by display_name or x_user_id query" do
      User.create!(x_user_id: "target-id-99", display_name: "Target User One", plan: none_plan)
      User.create!(x_user_id: "other-id", display_name: "Other User", plan: none_plan)

      get :index, params: { search_user: "Target" }
      users = controller.instance_variable_get(:@users)
      expect(users.map(&:x_user_id)).to include("target-id-99")
      expect(users.map(&:x_user_id)).not_to include("other-id")

      get :index, params: { search_user: "target-id-99" }
      users = controller.instance_variable_get(:@users)
      expect(users.map(&:x_user_id)).to include("target-id-99")
      expect(users.map(&:x_user_id)).not_to include("other-id")
    end

    it "filters follower caches list by x_user_id query" do
      FollowerCache.create!(x_user_id: "cache-target", fetched_at: Time.current)
      FollowerCache.create!(x_user_id: "cache-other", fetched_at: Time.current)

      get :index, params: { search_cache: "cache-target" }
      caches = controller.instance_variable_get(:@follower_caches)
      expect(caches.map(&:x_user_id)).to include("cache-target")
      expect(caches.map(&:x_user_id)).not_to include("cache-other")
    end
  end

  describe "POST #create" do
    it "creates a new manual bypass user and redirects to index" do
      expect {
        post :create, params: { x_user_id: "12345", display_name: "Manual User" }
      }.to change(User, :count).by(1)

      user = User.find_by(x_user_id: "12345")
      expect(user.is_manual_member).to be(true)
      expect(user.plan).to eq(member_plan)
      expect(response).to redirect_to(admin_users_path)
    end

    it "fails to create user and sets alert when params are missing" do
      expect {
        post :create, params: { x_user_id: "", display_name: "" }
      }.not_to change(User, :count)

      expect(flash[:alert]).to eq(I18n.t("admin.users.create.params_missing"))
      expect(response).to redirect_to(admin_users_path)
    end

    it "self-heals missing member plan and succeeds" do
      UserQuest.delete_all
      User.delete_all
      Plan.where(code: %w[member none]).delete_all

      expect {
        post :create, params: { x_user_id: "12345", display_name: "Manual User" }
      }.to change(User, :count).by(1)

      expect(response).to redirect_to(admin_users_path)
      expect(Plan.find_by(code: "member")).to be_present
    end
  end

  describe "PATCH #toggle_bypass" do
    it "toggles the is_manual_member attribute and adjusts the plan" do
      user = User.create!(x_user_id: "x-2", display_name: "Test User", plan: none_plan, is_manual_member: false)

      patch :toggle_bypass, params: { id: user.id }

      user.reload
      expect(user.is_manual_member).to be(true)
      expect(user.plan).to eq(member_plan)

      patch :toggle_bypass, params: { id: user.id }

      user.reload
      expect(user.is_manual_member).to be(false)
      expect(user.plan).to eq(none_plan)
    end

    it "recalculates and keeps member plan on release if user is in cache" do
      user = User.create!(x_user_id: "x-cache-1", display_name: "Follower", plan: member_plan, is_manual_member: true)
      FollowerCache.create!(x_user_id: "x-cache-1", fetched_at: Time.current)

      patch :toggle_bypass, params: { id: user.id }

      user.reload
      expect(user.is_manual_member).to be(false)
      expect(user.plan).to eq(member_plan)
    end

    it "recalculates and keeps member plan on release if user is in ENV bypass list" do
      user = User.create!(x_user_id: "x-env-1", display_name: "Bypass User", plan: member_plan, is_manual_member: true)
      allow(Rails.configuration.x).to receive(:follower_gate_bypass_user_ids).and_return(Set.new([ "x-env-1" ]))

      patch :toggle_bypass, params: { id: user.id }

      user.reload
      expect(user.is_manual_member).to be(false)
      expect(user.plan).to eq(member_plan)
    end

    it "self-heals missing member and none plans during bypass toggle" do
      UserQuest.delete_all
      User.delete_all
      dummy_plan = Plan.create!(code: "dummy")
      user = User.create!(x_user_id: "x-2", display_name: "Test User", plan: dummy_plan, is_manual_member: false)

      Plan.where(code: %w[member none]).delete_all

      patch :toggle_bypass, params: { id: user.id }

      user.reload
      expect(user.is_manual_member).to be(true)
      expect(Plan.find_by(code: "member")).to be_present

      # もう一度トグルして解除する（この時 follower_gate.rb が none プランを自己修復することを確認）
      user.update!(plan: dummy_plan)
      Plan.where(code: %w[member none]).delete_all

      patch :toggle_bypass, params: { id: user.id }

      user.reload
      expect(user.is_manual_member).to be(false)
      expect(Plan.find_by(code: "none")).to be_present
    end
  end

  describe "CSRF protection" do
    it "raises InvalidAuthenticityToken when authenticity token is missing on POST/PATCH" do
      original_allow_forgery_protection = ActionController::Base.allow_forgery_protection
      ActionController::Base.allow_forgery_protection = true

      begin
        allow(controller).to receive(:verify_authenticity_token).and_call_original

        expect {
          post :create, params: { x_user_id: "12345", display_name: "Manual User" }
        }.to raise_error(ActionController::InvalidAuthenticityToken)
      ensure
        ActionController::Base.allow_forgery_protection = original_allow_forgery_protection
      end
    end
  end
end
