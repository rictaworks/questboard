class SessionController < ApplicationController
  before_action :require_current_user!, only: :recheck

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
        xUserId: user.x_user_id,
        displayName: user.display_name,
        planCode: user.plan&.code
      }
    }
  end

  def recheck
    user = Auth::ManualFollowerRecheck.new(user: current_user).call

    render json: {
      authenticated: true,
      user: {
        id: user.id,
        xUserId: user.x_user_id,
        displayName: user.display_name,
        planCode: user.plan&.code
      }
    }
  end

  def destroy
    reset_session
    head :no_content
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end
end
