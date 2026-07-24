class ObjectsController < ApplicationController
  class UnsupportedOpPropertyError < StandardError; end
  class StaleOpError < StandardError; end
  class ConflictingOpError < StandardError; end
  class InvalidOpValueError < StandardError; end
  class ImplausibleLamportJumpError < StandardError; end
  class ReservedClientIdError < StandardError; end

  OP_PROPERTY_ACTIONS = {
    "geometry" => :edit_object,
    "color" => :recolor_object,
    "deleted_at" => :delete_object
  }.freeze

  # lamport_ts is a client-generated Lamport logical counter (not a wall-clock timestamp),
  # normally advancing by roughly 1 per local causal edit. A single op is never expected to
  # legitimately jump this far ahead of the last recorded value for the same object and
  # property, so rejecting larger jumps blocks a malicious/buggy client from stranding the
  # property forever with an extreme value (e.g. the bigint max) that no future op could
  # ever exceed.
  MAX_LAMPORT_JUMP = 100_000

  # The move/resize/rotate/recolor/destroy endpoints predate object_ops and have no
  # client-generated Lamport counter of their own. Recording them under this fixed
  # client_id (rather than skipping object_ops entirely) keeps every write to a
  # Lamport-ordered property in the same log apply_op reads from, so the "latest" pointer
  # never goes stale relative to the object's actual state — see PR #53 review.
  LEGACY_OP_CLIENT_ID = "legacy"

  before_action :require_current_user!

  def create
    board = find_authorized_board!(:create_object)
    return if performed?

    membership = board_membership_for(board)
    parent_frame = active_parent_frame_for(board)
    if parent_frame && membership && !authorize_object!(membership.role.code, :edit_object, parent_frame)
      return
    end

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

  def duplicate
    object = find_authorized_object!(:edit_object)
    return if performed?

    duplicated_object = object.board.board_objects.create!(
      object_type: object.object_type,
      color_palette: object.color_palette,
      parent_frame_id: object.parent_frame_id,
      geometry: object.geometry.merge("x" => object.geometry.fetch("x", 0) + 24, "y" => object.geometry.fetch("y", 0) + 24),
      deleted_at: nil
    )

    render json: serialize_object(duplicated_object), status: :created
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def recolor
    object = find_authorized_object!(:recolor_object)
    return if performed?

    # Resolve to the palette's own id (always an Integer) before recording it, rather than
    # passing params[:color_id] through as-is — a form-encoded request sends it as a String
    # ("1"), and ObjectOp.value/the Redis broadcast would otherwise carry that String while
    # the object's persisted color_palette_id is the coerced Integer, leaving connected
    # clients unable to resolve the color from the type they expect (see PR #53 review).
    palette = ColorPalette.find(params.require(:color_id))
    record_and_apply_legacy_op!(object, "color", { "color_id" => palette.id })
    render json: serialize_object(object.reload)
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def destroy
    object = find_authorized_object!(:delete_object)
    return if performed?

    record_and_apply_legacy_op!(object, "deleted_at", {})
    render json: serialize_object(object.reload)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  def lock
    object = find_authorized_object!(:lock_frame)
    return if performed?

    lock = object.frame_lock || object.build_frame_lock
    lock.update!(locked_by: current_user.id, locked_at: Time.current)

    render json: serialize_object(object.reload)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotUnique
    render json: { error: "Object was locked by another user" }, status: :conflict
  end

  def unlock
    object = find_authorized_object!(:unlock_frame)
    return if performed?

    unless object.frame_lock.present?
      head :forbidden
      return
    end

    object.frame_lock.destroy!
    render json: serialize_object(object.reload)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  end

  # Applies a Lamport-ordered operation coming from the sync-server. Unlike move/resize/
  # rotate/color/destroy (which trust whichever request lands last), this endpoint records
  # each op in object_ops and rejects anything not newer than what is already recorded for
  # the object, so a delayed or duplicate op can never overwrite a more recent confirmed
  # value. object_ops' unique index on (object_id, client_id, lamport_ts) makes retries of
  # the exact same op idempotent.
  def apply_op
    property = params.require(:property)
    action = op_action_for(property)
    object = find_authorized_op_object!(action:, property:)
    return if performed?

    lamport_ts = Integer(params.require(:lamport_ts))
    client_id = params.require(:client_id).to_s
    # LEGACY_OP_CLIENT_ID is reserved for record_and_apply_legacy_op! (see its declaration
    # above): a real client sending it here would share the (object_id, client_id,
    # lamport_ts) space with synthetic legacy ops on unrelated properties, so an unrelated
    # legacy write could consume the lamport_ts this op needs and turn a legitimate op into
    # a ConflictingOpError (see PR #53 review).
    raise ReservedClientIdError, "client_id #{LEGACY_OP_CLIENT_ID.inspect} is reserved" if client_id == LEGACY_OP_CLIENT_ID

    incoming_value = op_value_for_storage(property)

    confirmed_op = nil

    object.with_lock do
      existing = ObjectOp.find_by(object_id: object.id, client_id:, lamport_ts:)
      if existing
        if existing.property != property || existing.value != incoming_value
          raise ConflictingOpError, "an operation with the same client_id/lamport_ts but a different property or value was already recorded"
        end

        confirmed_op = existing
      else
        latest = ObjectOp.where(object_id: object.id, property:).order(lamport_ts: :desc).first
        if latest && lamport_ts <= latest.lamport_ts
          raise StaleOpError, "lamport_ts #{lamport_ts} is not newer than recorded #{latest.lamport_ts} for property #{property}"
        end

        baseline = latest&.lamport_ts || 0
        if lamport_ts - baseline > MAX_LAMPORT_JUMP
          raise ImplausibleLamportJumpError, "lamport_ts #{lamport_ts} jumps #{lamport_ts - baseline} ahead of #{baseline} for property #{property}, exceeding the max allowed jump of #{MAX_LAMPORT_JUMP}"
        end

        confirmed_op = ObjectOp.create!(
          board: object.board,
          board_object: object,
          user: current_user,
          property:,
          value: incoming_value,
          lamport_ts:,
          client_id:
        )

        apply_mutation_for!(object, property, incoming_value)
      end
    end

    render json: serialize_op(confirmed_op)
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue UnsupportedOpPropertyError, InvalidOpValueError, ImplausibleLamportJumpError, ReservedClientIdError => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ArgumentError, TypeError
    render json: { error: "lamport_ts must be an integer" }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotUnique
    # A concurrent request won the insert race for this exact (object_id, client_id,
    # lamport_ts). Echo back that record's own value/lamport_ts/client_id, same as the
    # ordinary idempotent-duplicate path above — never the object's current aggregate
    # state, which may already reflect a different, newer op.
    render json: serialize_op(ObjectOp.find_by!(object_id: object.id, client_id:, lamport_ts:))
  rescue StaleOpError, ConflictingOpError => e
    render json: { error: e.message }, status: :conflict
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

  def active_parent_frame_for(board)
    parent_frame_id = create_params[:parent_frame_id]
    return if parent_frame_id.blank?

    board.board_objects.active.find_by(id: parent_frame_id)
  end

  # boardのみを必要とするアクション(create)向け。認可失敗時はforbiddenをrenderしてnilを返す。
  def find_authorized_board!(action)
    board = find_board!
    return unless authorize_member!(board:, action:)

    board
  end

  # 既存オブジェクトを必要とするアクション(destroy/lock/unlock/move/resize/rotate)向け。
  # 認可失敗時はforbiddenをrenderしてnilを返す。
  def find_authorized_object!(action)
    board = find_board!
    object = find_board_object!(board)
    return unless authorize_member!(board:, action:, object:)

    object
  end

  def authorize_member!(board:, action:, object: nil)
    member = board_membership_for(board)
    unless member
      head :forbidden
      return false
    end

    authorize_object!(member.role.code, action, object)
  end

  def authorize_object!(role_code, action, object = nil)
    state = object_state(object)
    return true if PermissionService.new.authorize(role_code, action, state)

    head :forbidden
    false
  end

  def mutate_geometry(action)
    object = find_authorized_object!(action)
    return if performed?

    record_and_apply_legacy_op!(object, "geometry", validate_numeric_geometry_fields!(geometry_params.to_h))
    render json: serialize_object(object.reload)
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  rescue InvalidOpValueError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def lock_resolver_for(object)
    @lock_resolver ||= BoardLockResolver.for_chain(object)
  end

  def object_state(object)
    return {} unless object

    lock_resolver_for(object).object_state(object, current_user_id: current_user&.id)
  end

  def board_membership_for(board)
    board.board_members.includes(:role).find_by(user: current_user)
  end

  def serialize_object(object)
    resolver = lock_resolver_for(object)
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

  # Mirrors the sync-server's confirmed-op payload shape (property/value/lamport_ts/
  # client_id), built from the op that was actually recorded — never from the object's
  # current aggregate state, which can already reflect a different, newer op by the time
  # this renders (e.g. for a retried/duplicate op).
  def serialize_op(object_op)
    {
      property: object_op.property,
      value: object_op.value,
      lamportTs: object_op.lamport_ts,
      clientId: object_op.client_id
    }
  end

  def create_params
    params.permit(:object_type_code, :parent_frame_id, :color_id, geometry: %i[x y w h rotation])
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

  def op_action_for(property)
    OP_PROPERTY_ACTIONS.fetch(property) { raise UnsupportedOpPropertyError, "unsupported op property #{property}" }
  end

  # Like find_authorized_object!, but a "deleted_at" op is allowed to target an object
  # that is already soft-deleted, so a retried delete op can still be recognized as an
  # idempotent duplicate instead of 404ing (the object_ops row is what dedups it, not
  # object visibility).
  def find_authorized_op_object!(action:, property:)
    board = find_board!
    object = find_op_target_object!(board, property)
    return unless authorize_member!(board:, action:, object:)

    object
  end

  def find_op_target_object!(board, property)
    object = board.board_objects.active.find_by(id: params.require(:id))
    return object if object
    return board.board_objects.find(params.require(:id)) if property == "deleted_at"

    raise ActiveRecord::RecordNotFound
  end

  def op_value_params
    params[:value].is_a?(ActionController::Parameters) ? params[:value] : ActionController::Parameters.new
  end

  def op_geometry_params
    op_value_params.permit(:x, :y, :w, :h, :rotation)
  end

  def op_color_id
    permitted = op_value_params.permit(:color_id, :id, :colorId)
    permitted[:color_id] || permitted[:id] || permitted[:colorId]
  end

  def op_value_for_storage(property)
    case property
    when "geometry" then validated_geometry_value
    when "color" then { "color_id" => op_color_id }
    when "deleted_at" then {}
    end
  end

  def validated_geometry_value
    validate_numeric_geometry_fields!(op_geometry_params.to_h)
  end

  # ActionController::Parameters#permit only allowlists keys, not value types — a
  # geometry write submitting {"x": true, "rotation": "bogus"} would otherwise pass
  # straight through and get merged into the objects.geometry jsonb column as literal
  # non-numeric values, corrupting persisted state for every future reader of that object.
  # Shared by apply_op and the legacy move/resize/rotate endpoints so both write paths
  # enforce the same shape.
  def validate_numeric_geometry_fields!(geometry)
    geometry.each do |field, value|
      next if value.is_a?(Numeric)

      raise InvalidOpValueError, "geometry.#{field} must be numeric, got #{value.class}"
    end
    geometry
  end

  # Applies property's mutation using an already-built value (as produced by
  # op_value_for_storage or a legacy endpoint's own params), so this is shared between
  # apply_op and record_and_apply_legacy_op! without re-reading request params twice.
  def apply_mutation_for!(object, property, value)
    case property
    when "geometry"
      object.update!(geometry: object.geometry.merge(value))
    when "color"
      object.update!(color_palette: ColorPalette.find(value.fetch("color_id")))
    when "deleted_at"
      object.update!(deleted_at: Time.current)
    end
  end

  # Records value as the next ObjectOp for object/property and applies the corresponding
  # mutation, atomically with the same object row lock apply_op uses. This keeps the
  # legacy write paths and apply_op on a single shared ordering timeline instead of
  # silently diverging.
  #
  # lamport_ts is one past the higher of two independent baselines: the latest recorded
  # for this specific property (so a real client's future apply_op correctly sees this
  # write as newer for that property) and the latest recorded for LEGACY_OP_CLIENT_ID
  # across *any* property on this object (object_ops' unique index is scoped to
  # object_id+client_id+lamport_ts, not property, so every op sharing this fixed
  # client_id — regardless of which property it touched — must have a distinct value).
  def record_and_apply_legacy_op!(object, property, value)
    confirmed_op = nil

    object.with_lock do
      latest_for_property = ObjectOp.where(object_id: object.id, property:).maximum(:lamport_ts) || 0
      latest_for_client = ObjectOp.where(object_id: object.id, client_id: LEGACY_OP_CLIENT_ID).maximum(:lamport_ts) || 0
      lamport_ts = [ latest_for_property, latest_for_client ].max + 1

      confirmed_op = ObjectOp.create!(
        board: object.board,
        board_object: object,
        user: current_user,
        property:,
        value:,
        lamport_ts:,
        client_id: LEGACY_OP_CLIENT_ID
      )

      apply_mutation_for!(object, property, value)
    end

    # Publish outside the row lock (this is network I/O, not something that should hold a
    # DB lock) and after the mutation has already committed successfully — object_ops is
    # the source of truth regardless of whether this notification reaches anyone.
    broadcast_legacy_op(object.board, confirmed_op)
  end

  def broadcast_legacy_op(board, object_op)
    sync_op_relay.publish(board_share_token: board.share_token, object_op:)
  rescue SyncOpRelay::PublishError => e
    # e.message is deliberately omitted: it can echo back the raw SYNC_SERVER_REDIS_URL
    # (including any embedded credentials) verbatim from a URI-parse or connection failure
    # (see PR #53 review), so only the exception class is safe to log here.
    Rails.logger.error("SyncOpRelay publish failed for object_op=#{object_op.id}: #{e.cause&.class || e.class}")
  end

  def sync_op_relay
    @sync_op_relay ||= SyncOpRelay.new
  end
end
