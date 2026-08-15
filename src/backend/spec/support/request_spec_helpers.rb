module RequestSpecHelpers
  def seed_roles
    Role.upsert_all(
      [
        { code: "owner" },
        { code: "editor" },
        { code: "commenter" },
        { code: "viewer" }
      ],
      unique_by: :index_roles_on_code
    )
  end

  def sign_in(user = nil)
    user ||= self.user if respond_to?(:user)

    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
  end
end

RSpec.configure do |config|
  config.include RequestSpecHelpers, type: :request
end
