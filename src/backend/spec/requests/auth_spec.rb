require "rails_helper"

RSpec.describe "X authentication", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:user) { User.create!(x_user_id: "x-sub-123", display_name: "Ada Lovelace", plan: none_plan) }

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
  end

  it "returns the active session" do
    get "/session"

    expect(response).to have_http_status(:unauthorized)
    expect(JSON.parse(response.body)).to eq("authenticated" => false)
  end

  it "creates a session after X login completes" do
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
    expect(JSON.parse(response.body)).to eq(
      "authenticated" => true,
      "user" => {
        "id" => user.id,
        "xUserId" => "x-sub-123",
        "displayName" => "Ada Lovelace",
        "planCode" => "none"
      }
    )

    get "/session"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq(
      "authenticated" => true,
      "user" => {
        "id" => user.id,
        "xUserId" => "x-sub-123",
        "displayName" => "Ada Lovelace",
        "planCode" => "none"
      }
    )
  end

  it "rechecks the current user's plan after the cooldown has elapsed" do
    recheck_client = instance_double(Auth::XFollowersClient)
    allow(Auth::XFollowersClient).to receive(:new).and_return(recheck_client)
    allow(recheck_client).to receive(:fetch_followers_page).and_return(
      Auth::XFollowersClient::Page.new(ids: [ "x-sub-123" ], next_token: nil)
    )
    allow(session_creator).to receive(:call).and_return(user)

    travel_to(Time.zone.local(2026, 8, 13, 12, 0, 0)) do
      post "/auth/x_sessions", params: {
        code: "authorization-code",
        code_verifier: "pkce-verifier",
        recaptcha_token: "recaptcha-token"
      }, as: :json

      post "/session/recheck"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq(
        "authenticated" => true,
        "user" => {
          "id" => user.id,
          "xUserId" => "x-sub-123",
          "displayName" => "Ada Lovelace",
          "planCode" => "member"
        }
      )
      expect(recheck_client).to have_received(:fetch_followers_page)
    end
  end

  it "returns a cooldown response and avoids X API calls when the user rechecks too soon" do
    recheck_client = instance_double(Auth::XFollowersClient)
    allow(Auth::XFollowersClient).to receive(:new).and_return(recheck_client)
    allow(recheck_client).to receive(:fetch_followers_page).and_return(
      Auth::XFollowersClient::Page.new(ids: [ "x-sub-123" ], next_token: nil)
    )
    allow(session_creator).to receive(:call).and_return(user)

    travel_to(Time.zone.local(2026, 8, 13, 12, 0, 0)) do
      post "/auth/x_sessions", params: {
        code: "authorization-code",
        code_verifier: "pkce-verifier",
        recaptcha_token: "recaptcha-token"
      }, as: :json

      post "/session/recheck"
      expect(response).to have_http_status(:ok)

      expect(recheck_client).not_to receive(:fetch_followers_page)

      post "/session/recheck"

      expect(response).to have_http_status(:too_many_requests)
      expect(JSON.parse(response.body)).to eq(
        "error" => "手動再判定はあと15分0秒後にできます",
        "remainingMinutes" => 15,
        "remainingSeconds" => 0
      )
    end
  end

  it "rejects the session when reCAPTCHA verification fails" do
    allow(session_creator).to receive(:call).and_raise(Auth::RecaptchaVerifier::Error, "reCAPTCHA verification failed")

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "bad-token"
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "reCAPTCHA の検証に失敗しました")

    get "/session"

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects the session when X OAuth exchange fails" do
    allow(session_creator).to receive(:call).and_raise(Auth::XOauthClient::Error, "X OAuth response was missing an expected field")

    post "/auth/x_sessions", params: {
      code: "bad-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:bad_gateway)
    expect(JSON.parse(response.body)).to eq("error" => "Xログインに失敗しました")

    get "/session"

    expect(response).to have_http_status(:unauthorized)
  end

  it "logs out the current session" do
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    delete "/session"

    expect(response).to have_http_status(:no_content)

    get "/session"

    expect(response).to have_http_status(:unauthorized)
  end
end
