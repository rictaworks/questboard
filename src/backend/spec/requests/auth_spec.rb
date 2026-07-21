require "rails_helper"

RSpec.describe "Google authentication", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:user) { User.create!(google_sub: "google-sub-123", display_name: "Ada Lovelace") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
  end

  it "returns the active session" do
    get "/session"

    expect(response).to have_http_status(:unauthorized)
    expect(JSON.parse(response.body)).to eq("authenticated" => false)
  end

  it "creates a session after Google login completes" do
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
    expect(JSON.parse(response.body)).to eq(
      "authenticated" => true,
      "user" => {
        "id" => user.id,
        "googleSub" => "google-sub-123",
        "displayName" => "Ada Lovelace"
      }
    )

    get "/session"

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq(
      "authenticated" => true,
      "user" => {
        "id" => user.id,
        "googleSub" => "google-sub-123",
        "displayName" => "Ada Lovelace"
      }
    )
  end

  it "rejects the session when reCAPTCHA verification fails" do
    allow(session_creator).to receive(:call).and_raise(Auth::RecaptchaVerifier::Error, "reCAPTCHA verification failed")

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "bad-token"
    }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body)).to eq("error" => "reCAPTCHA verification failed")

    get "/session"

    expect(response).to have_http_status(:unauthorized)
  end

  it "logs out the current session" do
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
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
