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
      user: serialize_user(user)
    }
  end

  def recheck
    user = Auth::ManualFollowerRecheck.new(user: current_user).call

    render json: {
      authenticated: true,
      user: serialize_user(user)
    }
  end

  def destroy
    reset_session
    head :no_content
  end

  private

  def serialize_user(user)
    {
      id: user.id,
      xUserId: user.x_user_id,
      displayName: user.display_name,
      planCode: user.plan&.code,
      # 拒否された利用者が運用者へ申告する値。判定サービスの照会用IDは判定に用いる
      # 数値ユーザーIDそのものと定められている（x-follower-gate requirements.md 第13章）。
      # 応答との食い違いは Auth::FollowerGateClient が記録に残す。
      inquiryId: user.x_user_id
    }
  end

  def require_current_user!
    head :unauthorized unless current_user
  end
end
