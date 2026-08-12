module Auth
  class XSessionsController < ApplicationController
    def create
      user = XSessionCreator.new.call(
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
      end

    private

    def serialize_user(user)
      {
        id: user.id,
        xUserId: user.x_user_id,
        displayName: user.display_name
      }
    end
  end
end
