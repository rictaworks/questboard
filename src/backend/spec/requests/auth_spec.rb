require "rails_helper"

RSpec.describe "X authentication", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
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

  it "returns unauthorized when trying to recheck without a session" do
    post "/session/recheck", as: :json

    expect(response).to have_http_status(:unauthorized)
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

      post "/session/recheck", as: :json

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

  it "returns a cooldown response when the manual recheck service rejects the request" do
    allow(Auth::ManualFollowerRecheck).to receive(:new).and_raise(
      Auth::ManualFollowerRecheck::CooldownError.new(remaining_seconds: 900)
    )
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    post "/session/recheck", as: :json

    expect(response).to have_http_status(:too_many_requests)
    expect(JSON.parse(response.body)).to eq(
      "error" => "手動再判定はあと15分0秒後にできます",
      "remainingMinutes" => 15,
      "remainingSeconds" => 0
    )
  end

  # クールダウン判定はサービス層の spec でも見ているが、それだけでは
  # 「コントローラ側でクールダウン判定より前にX APIへ到達する経路が生えた」場合に
  # 気づけない。Issue #133 の受け入れ要件は「連打がX APIに到達しないこと」なので、
  # エンドポイント経由でX APIクライアントが呼ばれないことをここで固定する。
  it "never reaches the X API when the endpoint is hit again during the cooldown" do
    recheck_client = instance_double(Auth::XFollowersClient)
    allow(Auth::XFollowersClient).to receive(:new).and_return(recheck_client)
    allow(recheck_client).to receive(:fetch_followers_page).and_return(
      Auth::XFollowersClient::Page.new(ids: [], next_token: nil)
    )
    allow(session_creator).to receive(:call).and_return(user)

    travel_to(Time.zone.local(2026, 8, 13, 12, 0, 0)) do
      post "/auth/x_sessions", params: {
        code: "authorization-code",
        code_verifier: "pkce-verifier",
        recaptcha_token: "recaptcha-token"
      }, as: :json

      post "/session/recheck", as: :json
      expect(response).to have_http_status(:ok)

      # 1回目でX APIへ到達した回数を確定させ、以降の連打で増えないことを見る。
      calls_after_first = 0
      allow(recheck_client).to receive(:fetch_followers_page) do
        calls_after_first += 1
        Auth::XFollowersClient::Page.new(ids: [], next_token: nil)
      end

      3.times do
        post "/session/recheck", as: :json
        expect(response).to have_http_status(:too_many_requests)
      end

      expect(calls_after_first).to eq(0)
    end
  end

  # 設計書 4.4「X API障害 → 一時的な失敗として通知 / plan は据え置く」。
  # rescue_from が無いと素の 500 になり、利用者にも運用にも障害だと伝わらない。
  it "reports an X API outage as a temporary failure and keeps the plan unchanged" do
    recheck_client = instance_double(Auth::XFollowersClient)
    allow(Auth::XFollowersClient).to receive(:new).and_return(recheck_client)
    allow(recheck_client).to receive(:fetch_followers_page)
      .and_raise(Auth::XFollowersClient::RequestError, "X API is unavailable")
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    post "/session/recheck", as: :json

    expect(response).to have_http_status(:bad_gateway)
    expect(JSON.parse(response.body)).to eq("error" => "フォロー状態を確認できませんでした。時間をおいて再度お試しください")
    expect(user.reload.plan.code).to eq("none")
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
