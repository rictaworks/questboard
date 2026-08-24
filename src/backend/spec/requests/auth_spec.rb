require "rails_helper"

RSpec.describe "X authentication", type: :request do
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
        "planCode" => "none",
        "inquiryId" => "x-sub-123"
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
        "planCode" => "none",
        "inquiryId" => "x-sub-123"
      }
    )
  end

  it "rechecks the current user's plan through the follower gate" do
    recheck_client = instance_double(Auth::FollowerGateClient)
    allow(Auth::FollowerGateClient).to receive(:new).and_return(recheck_client)
    allow(recheck_client).to receive(:request_recheck).and_return(
      Auth::FollowerGateClient::RecheckResult.new(
        result: "accepted", retry_after: nil, plan: "full", inquiry_id: "x-sub-123"
      )
    )
    allow(session_creator).to receive(:call).and_return(user)

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
        "planCode" => "member",
        "inquiryId" => "x-sub-123"
      }
    )
    expect(recheck_client).to have_received(:request_recheck)
  end

  # 待機の判断は判定サービスが行う（x-follower-gate 第11章）。questboard 側は
  # 判定サービスが返した再要求可能時刻をそのまま渡すだけで、残り時間を数え直さない。
  it "returns the retry time the follower gate reported when the recheck is throttled" do
    allow(Auth::ManualFollowerRecheck).to receive(:new).and_raise(
      Auth::ManualFollowerRecheck::ThrottledError.new(retry_after: "2026-08-25T12:15:00.000+09:00")
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
      "error" => "手動再判定の要求が続いています。しばらく時間をおいて再度お試しください",
      "retryAfter" => "2026-08-25T12:15:00.000+09:00"
    )
  end

  # Issue #133 の受け入れ要件は「連打が X API に到達しないこと」。委譲後、questboard は
  # X API へ到達する経路そのものを持たない。連打の抑止は判定サービスのクールダウンが担い、
  # questboard 側は要求を素通しするだけなので、ここでは「X API を呼ぶ器が無いこと」を固定する。
  it "has no path from questboard to the X API" do
    offenders = Dir[Rails.root.join("app/**/*.rb")].select do |path|
      File.read(path).match?(/api\.x\.com\/2\/users\/[^\s]*followers/)
    end

    expect(offenders).to be_empty
  end

  # 設計書 4.4「上流の障害 → 一時的な失敗として通知 / plan は据え置く」。
  # rescue_from が無いと素の 500 になり、利用者にも運用にも障害だと伝わらない。
  it "reports a follower gate outage as a temporary failure and keeps the plan unchanged" do
    recheck_client = instance_double(Auth::FollowerGateClient)
    allow(Auth::FollowerGateClient).to receive(:new).and_return(recheck_client)
    allow(recheck_client).to receive(:request_recheck)
      .and_raise(Auth::FollowerGateClient::RequestError, "follower gate is unavailable")
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

    # フロントエンド（app/../auth-panel.tsx handleSignOut）はボディなしの
    # fetch(..., { method: "DELETE" }) でログアウトしており、実ブラウザは
    # Content-Typeヘッダーを送らない。素の delete "/session" だと
    # Rails のテストヘルパーが application/x-www-form-urlencoded を既定で
    # 付与してしまい、RequestOriginGuardのCSRF対策（フォーム形式の
    # 状態変更リクエストを拒否する）に誤って引っかかるため、実際の
    # 送信内容に合わせて as: :json を明示する。
    delete "/session", as: :json

    expect(response).to have_http_status(:no_content)

    get "/session"

    expect(response).to have_http_status(:unauthorized)
  end
end
