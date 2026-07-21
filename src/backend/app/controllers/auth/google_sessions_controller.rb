module Auth
  class GoogleSessionsController < ApplicationController
    def create
      user = GoogleSessionCreator.new.call(
        code: params.require(:code),
        code_verifier: params.require(:code_verifier),
        recaptcha_token: params.require(:recaptcha_token),
        remote_ip: request.remote_ip
      )

      session[:user_id] = user.id

      render json: {
        authenticated: true,
        user: serialize_user(user)
      }, status: :created
    rescue ActionController::ParameterMissing => e
      render json: { error: e.message }, status: :unprocessable_entity
    rescue RecaptchaVerifier::Error => e
      render json: { error: e.message }, status: :unprocessable_entity
    rescue GoogleOauthClient::Error => e
      render json: { error: e.message }, status: :bad_gateway
    end

    private

    def serialize_user(user)
      {
        id: user.id,
        googleSub: user.google_sub,
        displayName: user.display_name
      }
    end
  end
end
