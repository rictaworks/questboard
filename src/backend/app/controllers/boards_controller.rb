class BoardsController < ApplicationController
  before_action :require_current_user!

  def create
    board = Board.create_with_owner!(title: create_params.fetch(:title), owner: current_user)
    render json: serialize_board(board, board.member_for!(current_user)), status: :created
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def join
    board = Board.find_by!(share_token: params.require(:share_token))
    role_code = invite_role_code

    unless Role.assignable_from_invite?(role_code)
      render json: { error: "Unsupported invite role" }, status: :unprocessable_entity
      return
    end

    membership = board.upsert_member!(user: current_user, role_code:)
    render json: serialize_board(board, membership), status: :created
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def update_member_role
    board = Board.find_by!(share_token: params.require(:share_token))
    actor_member = board.member_for!(current_user)

    unless PermissionService.new.authorize(actor_member.role.code, :change_role, {})
      head :forbidden
      return
    end

    target_member = board.board_members.includes(:role).find_by!(user_id: params.require(:user_id))
    role = Role.find_by!(code: role_code_param)
    target_member.update!(role:)

    render json: serialize_board(board, target_member)
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  def create_params
    params.permit(:title)
  end

  def invite_role_code
    params[:role_code].presence || "viewer"
  end

  def role_code_param
    params.require(:role_code)
  end

  def serialize_board(board, membership)
    {
      board: serialize_board_attributes(board),
      membership: serialize_membership(membership)
    }
  end

  def serialize_board_attributes(board)
    {
      id: board.id,
      title: board.title,
      shareToken: board.share_token
    }
  end

  def serialize_membership(membership)
    {
      userId: membership.user_id,
      role: {
        id: membership.role.id,
        code: membership.role.code
      }
    }
  end
end
