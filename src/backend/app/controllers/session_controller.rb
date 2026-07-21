class SessionController < ApplicationController
  def show
    user = current_user

    unless user
      render json: { authenticated: false }, status: :unauthorized
      return
    end

    render json: {
      authenticated: true,
      user: {
        id: user.id,
        googleSub: user.google_sub,
        displayName: user.display_name
      }
    }
  end

  def destroy
    reset_session
    head :no_content
  end
end
