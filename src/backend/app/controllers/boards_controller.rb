class BoardsController < ApplicationController
  before_action :require_current_user!

  def show
    board = Board.find_by!(share_token: params.require(:share_token))
    membership = board_membership_for(board)
    return unless authorize_board_view!(board:, membership:)

    render json: serialize_canvas_board(board, membership)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board not found" }, status: :not_found
  end

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

    membership = board.join_member!(user: current_user, role_code:)
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

    user_id = params.require(:user_id)
    role = Role.find_by!(code: role_code_param)

    board.with_lock do
      target_member = board.board_members.includes(:role).find_by!(user_id:)

      if demotes_last_owner?(board:, target_member:, new_role: role)
        render json: { error: "Cannot remove the last owner" }, status: :unprocessable_entity
        return
      end

      target_member.update!(role:)
      render json: serialize_board(board, target_member)
    end
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

  def demotes_last_owner?(board:, target_member:, new_role:)
    return false unless target_member.role.code == "owner"
    return false if new_role.code == "owner"

    !board.board_members
      .joins(:role)
      .where(roles: { code: "owner" })
      .where.not(id: target_member.id)
      .exists?
  end

  def serialize_board(board, membership)
    {
      board: serialize_board_attributes(board),
      membership: serialize_membership(membership)
    }
  end

  def serialize_canvas_board(board, membership)
    active_objects = board.board_objects.active.includes(:object_type, :frame_lock).order(:id).to_a
    resolver = BoardLockResolver.new(active_objects)

    {
      board: serialize_board_attributes(board),
      membership: serialize_membership(membership),
      objectTypes: ObjectType.order(:id).map { |type| { id: type.id, code: type.code } },
      colorPalettes: ColorPalette.order(:id).map { |color| { id: color.id, hex: color.hex } },
      objects: active_objects.map { |object| serialize_board_object(object, resolver) }
    }
  end

  def serialize_board_object(object, resolver = nil)
    resolver ||= BoardLockResolver.new(object.board)
    lock = resolver.effective_lock(object, current_user_id: current_user&.id)

    {
      id: object.id,
      boardId: object.board_id,
      objectTypeCode: object.object_type.code,
      colorId: object.color_id,
      parentFrameId: object.parent_frame_id,
      geometry: object.geometry,
      deletedAt: object.deleted_at&.iso8601,
      locked: lock.present?,
      lockedByUserId: lock&.locked_by,
      lockedAt: lock&.locked_at&.iso8601,
      lockOriginObjectId: lock&.object_id
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

  def board_membership_for(board)
    board.board_members.includes(:role).find_by(user: current_user)
  end

  def authorize_board_view!(board:, membership:)
    return true if membership && PermissionService.new.authorize(membership.role.code, :view_board, {})

    head :forbidden
    false
  end
end
