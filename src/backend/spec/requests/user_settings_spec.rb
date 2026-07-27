require "rails_helper"

RSpec.describe "User settings", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:user) { User.create!(google_sub: "google-sub-123", display_name: "Ada Lovelace") }
  let(:other_user) { User.create!(google_sub: "google-sub-456", display_name: "Grace Hopper") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
    IntensityMaster.upsert_all(
      [ { code: "full" }, { code: "subtle" }, { code: "off" } ],
      unique_by: :index_intensity_masters_on_code
    )
  end

  def sign_in(user)
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json
  end

  it "returns 401 when unauthenticated" do
    get "/user_settings"

    expect(response).to have_http_status(:unauthorized)
  end

  it "creates a default full intensity setting for the current user" do
    sign_in(user)

    expect {
      get "/user_settings"
    }.to change(UserSetting, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("intensity" => "full")
  end

  it "updates only the signed-in user's intensity and persists it across sessions" do
    sign_in(user)

    patch "/user_settings", params: { intensity: "subtle" }, as: :json

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("intensity" => "subtle")
    expect(UserSetting.find_by!(user_id: user.id).intensity_master.code).to eq("subtle")

    delete "/session"

    sign_in(other_user)
    get "/user_settings"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("intensity" => "full")
    expect(UserSetting.find_by!(user_id: other_user.id).intensity_master.code).to eq("full")
    expect(UserSetting.find_by!(user_id: user.id).intensity_master.code).to eq("subtle")
  end

  it "rejects unsupported intensity values with 422" do
    sign_in(user)

    patch "/user_settings", params: { intensity: "loud" }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body)).to eq("error" => "Invalid intensity")
    expect(UserSetting.find_by!(user_id: user.id).intensity_master.code).to eq("full")
  end
end
