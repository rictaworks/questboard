require "rails_helper"

RSpec.describe "X authentication", type: :request do
  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let(:user) { User.create!(x_user_id: "x-sub-123", display_name: "Ada Lovelace") }

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
        "displayName" => "Ada Lovelace"
      }
    )

    get "/session"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq(
      "authenticated" => true,
      "user" => {
        "id" => user.id,
        "xUserId" => "x-sub-123",
        "displayName" => "Ada Lovelace"
      }
    )
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
