class ObjectsController < ApplicationController
  before_action :require_current_user!

  def create
    board = find_board!
    member = board_membership_for(board)
    return head :forbidden unless member
    authorize_object!(member.role.code, :create_object)
    return if performed?

    object = board.board_objects.create!(
      object_type: ObjectType.find_by!(code: object_type_code_param),
      color_palette: ColorPalette.first!,
      parent_frame_id: create_params[:parent_frame_id],
      geometry: create_geometry,
      deleted_at: nil
    )

    render json: serialize_object(object), status: :created
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object type not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def move
    mutate_geometry(:move_object)
  end

  def resize
    mutate_geometry(:resize_object)
  end

  def rotate
    mutate_geometry(:rotate_object)
  end

  def destroy
    board = find_board!
    object = find_board_object!(board)
    member = board_membership_for(board)
    return head :forbidden unless member
    authorize_object!(member.role.code, :delete_object, object)
    return if performed?

    object.update!(deleted_at: Time.current)
    render json: serialize_object(object)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def lock
    board = find_board!
    object = find_board_object!(board)
    member = board_membership_for(board)
    return head :forbidden unless member
    authorize_object!(member.role.code, :lock_frame, object)
    return if performed?

    lock = object.frame_lock || object.build_frame_lock
    lock.update!(locked_by: current_user.id, locked_at: Time.current)

    render json: serialize_object(object.reload)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def unlock
    board = find_board!
    object = find_board_object!(board)
    member = board_membership_for(board)
    return head :forbidden unless member
    authorize_object!(member.role.code, :unlock_frame, object)
    return if performed?

    object.frame_lock&.destroy!
    render json: serialize_object(object.reload)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  def find_board!
    Board.find_by!(share_token: params.require(:share_token))
  end

  def find_board_object!(board = find_board!)
    board.board_objects.active.find(params.require(:id))
  end

  def authorize_object!(role_code, action, object = nil)
    state = object_state(object)
    return true if PermissionService.new.authorize(role_code, action, state)

    head :forbidden
    false
  end

  def mutate_geometry(action)
    board = find_board!
    object = find_board_object!(board)
    member = board_membership_for(board)
    return head :forbidden unless member
    authorize_object!(member.role.code, action, object)
    return if performed?

    updated_geometry = object.geometry.merge(geometry_params.to_h)
    object.update!(geometry: updated_geometry)
    render json: serialize_object(object)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def object_state(object)
    return {} unless object

    {
      locked: object.frame_lock.present?,
      locked_by_user_id: object.frame_lock&.locked_by,
      current_user_id: current_user&.id
    }
  end

  def board_membership_for(board)
    board.board_members.includes(:role).find_by(user: current_user)
  end

  def serialize_object(object)
    lock = object.frame_lock

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
      lockedAt: lock&.locked_at&.iso8601
    }
  end

  def create_params
    params.permit(:object_type_code, :parent_frame_id, geometry: %i[x y w h rotation])
  end

  def geometry_params
    (params[:geometry] || ActionController::Parameters.new).permit(:x, :y, :w, :h, :rotation)
  end

  def create_geometry
    default_geom = { "x" => 0, "y" => 0, "w" => 100, "h" => 100, "rotation" => 0 }
    geom_params = create_params[:geometry]
    return default_geom if geom_params.nil?

    default_geom.merge(geom_params.to_h)
  end

  def object_type_code_param
    create_params.require(:object_type_code)
  end
end
