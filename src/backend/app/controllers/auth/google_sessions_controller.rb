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
    rescue RecaptchaVerifier::Error => e
      logger.warn("[Auth::GoogleSessionsController#create] #{e.message}")
      render json: { error: I18n.t("api.errors.recaptcha_verification_failed") }, status: :unprocessable_content
    rescue GoogleOauthClient::Error => e
      logger.error("[Auth::GoogleSessionsController#create] #{e.message}")
      render json: { error: I18n.t("api.errors.google_oauth_failed") }, status: :bad_gateway
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
