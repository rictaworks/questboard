class ObjectsController < ApplicationController
  class UnsupportedOpPropertyError < StandardError; end
  class StaleOpError < StandardError; end
  class ConflictingOpError < StandardError; end
  class DeletedObjectEditError < StandardError; end
  class InvalidOpValueError < StandardError; end
  class ImplausibleLamportJumpError < StandardError; end
  class ReservedClientIdError < StandardError; end
  class OutdatedReferenceError < StandardError; end

  OP_PROPERTY_ACTIONS = {
    "geometry" => :edit_object,
    "color" => :recolor_object,
    "deleted_at" => :delete_object,
    "text_crdt" => :edit_object
  }.freeze

  MAX_OT_HISTORY_LIMIT = 100

  # lamport_ts is a client-generated Lamport logical counter (not a wall-clock timestamp),
  # normally advancing by roughly 1 per local causal edit. A single op is never expected to
  # legitimately jump this far ahead of the last recorded value for the same object and
  # property, so rejecting larger jumps blocks a malicious/buggy client from stranding the
  # property forever with an extreme value (e.g. the bigint max) that no future op could
  # ever exceed.
  MAX_LAMPORT_JUMP = 100_000
  MAX_TEXT_CRDT_OPS = 100
  MAX_TEXT_CRDT_INSERT_BYTES = 16 * 1024
  MAX_TEXT_CRDT_TEXT_BYTES = 64 * 1024
  MAX_TEXT_CRDT_ATTRIBUTES_BYTES = 2 * 1024
  MAX_TEXT_CRDT_ATTRIBUTES_DEPTH = 4
  # MAX_TEXT_CRDT_TEXT_BYTES only bounds the concatenated insert text, not the persisted
  # document as a whole — splitting that same text into many single-character runs, each
  # carrying its own (individually valid) MAX_TEXT_CRDT_ATTRIBUTES_BYTES-sized attributes,
  # would otherwise let an editor blow the stored document up to tens of MB despite every
  # individual op passing validation (see PR #55 review). This bounds the composed
  # document's own serialized size directly, regardless of how the text is split into runs.
  MAX_TEXT_CRDT_DOCUMENT_BYTES = 256 * 1024

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
    duplicate = false

    object.with_lock do
      if property != "deleted_at" && object.deleted_at.present?
        raise DeletedObjectEditError, "Object has been deleted; restore it before editing"
      end

      existing = ObjectOp.find_by(object_id: object.id, client_id:, lamport_ts:)
      if existing
        is_conflict = false
        if existing.property != property
          is_conflict = true
        elsif property == "text_crdt"
          stored_orig_ops = existing.value["original_ops"] || existing.value["ops"]
          incoming_ops = incoming_value["ops"] || incoming_value[:ops]
          stored_ref_revision = existing.value["ref_revision"]
          incoming_ref_revision = incoming_value["ref_revision"] || incoming_value[:ref_revision]
          # Same client_id/lamport_ts/ops but a different ref_revision means the client
          # transformed against a different base state, so the transform result recorded
          # under this key is no longer equivalent to what the retry actually asked for —
          # treat it as a genuine conflict rather than replaying the stale stored result.
          is_conflict = (stored_orig_ops != incoming_ops) || (stored_ref_revision != incoming_ref_revision)
        else
          is_conflict = (existing.value != incoming_value)
        end

        if is_conflict
          raise ConflictingOpError, "an operation with the same client_id/lamport_ts but a different property or value was already recorded"
        end

        confirmed_op = existing
        duplicate = true
      else
        if property != "text_crdt"
          latest = ObjectOp.where(object_id: object.id, property:).order(lamport_ts: :desc, client_id: :asc).first
          if latest && (lamport_ts < latest.lamport_ts || (lamport_ts == latest.lamport_ts && client_id > latest.client_id))
            raise StaleOpError, "op #{lamport_ts}/#{client_id} is not newer than recorded #{latest.lamport_ts}/#{latest.client_id} for property #{property}"
          end

          baseline = latest&.lamport_ts || 0
          if lamport_ts - baseline > MAX_LAMPORT_JUMP
            raise ImplausibleLamportJumpError, "lamport_ts #{lamport_ts} jumps #{lamport_ts - baseline} ahead of #{baseline} for property #{property}, exceeding the max allowed jump of #{MAX_LAMPORT_JUMP}"
          end
        end

        actual_value = incoming_value
        if property == "text_crdt"
          transformed_ops = transform_text_crdt_ops(object.id, incoming_value, client_id)
          actual_value = {
            "ops" => transformed_ops,
            "ref_revision" => incoming_value["ref_revision"] || incoming_value[:ref_revision],
            "original_ops" => incoming_value["ops"] || incoming_value[:ops]
          }
        end

        confirmed_op = ObjectOp.create!(
          board: object.board,
          board_object: object,
          user: current_user,
          property:,
          value: actual_value,
          lamport_ts:,
          client_id:
        )

        apply_mutation_for!(object, property, actual_value, client_id, lamport_ts, revision: confirmed_op.id)
      end
    end

    render json: serialize_op(confirmed_op, duplicate:)
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
    render json: serialize_op(ObjectOp.find_by!(object_id: object.id, client_id:, lamport_ts:), duplicate: true)
  rescue StaleOpError, ConflictingOpError, DeletedObjectEditError, OutdatedReferenceError => e
    payload = { error: e.message }
    payload[:restoreSuggested] = true if e.is_a?(DeletedObjectEditError)
    payload[:resyncRequired] = true if e.is_a?(OutdatedReferenceError)
    render json: payload, status: :conflict
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
      textCrdt: object.text_crdt,
      # The revision a client must echo back as ref_revision on its first text_crdt op
      # after loading this snapshot — 0 means no text_crdt history exists yet, which
      # transform_text_crdt_ops treats the same as an absent ref_revision. This reads the
      # object row's own persisted column (updated atomically with text_crdt in the same
      # transaction, see apply_mutation_for!) rather than a separate query, so the body and
      # revision returned here can never be from two different points in time.
      textCrdtRevision: object.text_crdt_revision,
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
  #
  # duplicate is true when confirmed_op was already recorded before this request (a retried
  # op, or one that lost an insert race) rather than newly created. text_crdt is a diff, not
  # an idempotent absolute value — the sync-server Handler must never broadcast/relay a
  # duplicate text_crdt op, since every other connected client already applied that exact
  # diff the first time, and re-applying it would double the insert/delete against their
  # live document and diverge from Rails' persisted state (see PR #55 review).
  def serialize_op(object_op, duplicate: false)
    val = object_op.value
    if object_op.property == "text_crdt" && val.is_a?(Hash)
      # "revision" is this op's own id (the server-assigned, persistence-order position) —
      # the client stores it and sends it back as ref_revision on its next text_crdt op, so
      # the server can determine what happened after this client last observed the
      # document (see transform_text_crdt_ops).
      val = {
        "ops" => val["ops"],
        "ref_revision" => val["ref_revision"],
        "revision" => object_op.id
      }.compact
    end
    {
      property: object_op.property,
      value: val,
      lamportTs: object_op.lamport_ts,
      clientId: object_op.client_id,
      duplicate:
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
    object = find_op_target_object!(board)
    return unless authorize_member!(board:, action:, object:)

    if property != "deleted_at" && object.deleted_at.present?
      raise DeletedObjectEditError, "Object has been deleted; restore it before editing"
    end

    object
  end

  def find_op_target_object!(board)
    board.board_objects.find(params.require(:id))
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
    when "deleted_at" then deleted_at_op_value
    when "text_crdt" then validated_text_crdt_value
    end
  end

  def deleted_at_op_value
    raw_value =
      case params[:value]
      when ActionController::Parameters
        params[:value].to_unsafe_h
      when Hash
        params[:value]
      else
        {}
      end

    normalized = raw_value.stringify_keys
    unknown_keys = normalized.keys - %w[restore]
    raise InvalidOpValueError, "deleted_at op contains unsupported keys: #{unknown_keys.join(', ')}" if unknown_keys.any?

    return { "restore" => true } if normalized["restore"] == true

    {}
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
  def apply_mutation_for!(object, property, value, client_id = nil, lamport_ts = nil, revision: nil)
    case property
    when "geometry"
      object.update!(geometry: object.geometry.merge(value))
    when "color"
      object.update!(color_palette: ColorPalette.find(value.fetch("color_id")))
    when "deleted_at"
      object.update!(deleted_at: value["restore"] ? nil : Time.current)
    when "text_crdt"
      # text_crdt and text_crdt_revision are updated together in this single call (itself
      # inside object.with_lock's transaction) so a reader can never observe one without
      # the matching other — computing the revision separately at read time would let a
      # concurrent writer land in between, pairing a stale body with a newer revision (or
      # vice versa) and silently corrupting the next OT pass (see PR #55 review).
      object.update!(text_crdt: merge_text_crdt_state(object.text_crdt, value), text_crdt_revision: revision)
    end
  end

  def validated_text_crdt_value
    raw_value = params.require(:value)
    normalized_value =
      case raw_value
      when ActionController::Parameters
        raw_value.to_unsafe_h
      when Hash
        raw_value
      else
        raise InvalidOpValueError, "text_crdt must be an object"
      end

    if normalized_value.key?("text") || normalized_value.key?(:text)
      raise InvalidOpValueError, "text_crdt snapshots must not include text"
    end

    ref_revision = normalized_value["ref_revision"] || normalized_value[:ref_revision]
    if ref_revision.present? && !ref_revision.is_a?(Integer)
      raise InvalidOpValueError, "ref_revision must be an integer"
    end

    ops = normalized_value.fetch("ops") { normalized_value[:ops] }
    raise InvalidOpValueError, "text_crdt must include ops" unless ops.is_a?(Array) && ops.present?
    raise InvalidOpValueError, "text_crdt ops must not exceed #{MAX_TEXT_CRDT_OPS}" if ops.length > MAX_TEXT_CRDT_OPS

    normalized_value = normalized_value.stringify_keys
    normalized_value["ops"] = ops.map { |op| validate_text_crdt_op!(op) }
    normalized_value["ref_revision"] = ref_revision if ref_revision.present?
    normalized_value
  end

  def validate_text_crdt_op!(op)
    normalized_op =
      case op
      when ActionController::Parameters
        op.to_unsafe_h
      when Hash
        op
      else
        raise InvalidOpValueError, "text_crdt ops must be objects"
      end.stringify_keys

    allowed_keys = %w[insert delete retain attributes]
    unknown_keys = normalized_op.keys - allowed_keys
    raise InvalidOpValueError, "text_crdt op contains unsupported keys: #{unknown_keys.join(', ')}" if unknown_keys.any?

    op_types = %w[insert delete retain].filter { |key| normalized_op.key?(key) }
    raise InvalidOpValueError, "text_crdt op must include exactly one of insert, delete, or retain" if op_types.length != 1

    if normalized_op.key?("insert") && !normalized_op["insert"].is_a?(String)
      raise InvalidOpValueError, "text_crdt insert must be a string"
    end
    if normalized_op.key?("delete")
      raise InvalidOpValueError, "text_crdt delete must be an integer" unless normalized_op["delete"].is_a?(Integer)
      # Zero is meaningless (a no-op that should simply be omitted) and negative values
      # exploit Ruby's negative String#slice semantics to shift the cursor backwards,
      # deleting characters the client never intended to touch (see PR #55 review).
      raise InvalidOpValueError, "text_crdt delete must be a positive integer" unless normalized_op["delete"].positive?
    end
    if normalized_op.key?("retain")
      raise InvalidOpValueError, "text_crdt retain must be an integer" unless normalized_op["retain"].is_a?(Integer)
      raise InvalidOpValueError, "text_crdt retain must be a positive integer" unless normalized_op["retain"].positive?
    end
    # key?/nil? (not present?/blank?) — present? is false for "", [], and false, which would
    # otherwise let those slip past this check unrejected and later reach
    # merge_text_crdt_attributes' Hash#merge call, raising a bare TypeError (500) instead of
    # a clean 422 here (see PR #55 review). nil is still fine: it means "no attributes".
    if normalized_op.key?("attributes") && !normalized_op["attributes"].nil? && !normalized_op["attributes"].is_a?(Hash)
      raise InvalidOpValueError, "text_crdt attributes must be an object"
    end
    if normalized_op["insert"].is_a?(String) && normalized_op["insert"].bytesize > MAX_TEXT_CRDT_INSERT_BYTES
      raise InvalidOpValueError, "text_crdt insert must not exceed #{MAX_TEXT_CRDT_INSERT_BYTES} bytes"
    end
    validate_text_crdt_attributes!(normalized_op["attributes"])

    normalized_op
  end

  def merge_text_crdt_state(existing_state, incoming_value)
    existing_state = existing_state.is_a?(Hash) ? existing_state : {}
    existing_ops = existing_state["ops"].is_a?(Array) ? existing_state["ops"] : []
    composed_ops = compose_text_crdt_ops(existing_ops, incoming_value.fetch("ops"))

    total_bytes = composed_ops.sum { |op| op["insert"].to_s.bytesize }
    raise InvalidOpValueError, "text_crdt text must not exceed #{MAX_TEXT_CRDT_TEXT_BYTES} bytes" if total_bytes > MAX_TEXT_CRDT_TEXT_BYTES

    # Bounds the *whole* persisted document (text plus every run's attributes combined),
    # not just the concatenated text above — see MAX_TEXT_CRDT_DOCUMENT_BYTES.
    document_bytes = composed_ops.to_json.bytesize
    raise InvalidOpValueError, "text_crdt document must not exceed #{MAX_TEXT_CRDT_DOCUMENT_BYTES} bytes" if document_bytes > MAX_TEXT_CRDT_DOCUMENT_BYTES

    { "ops" => composed_ops }
  end

  # Applies incoming_ops (an already OT-transformed text_crdt diff: insert/retain/delete,
  # where retain/insert may carry attributes) onto doc_ops — the currently persisted
  # document, itself an insert-only list of {"insert" => string, "attributes" => hash} runs
  # — and returns the new persisted document as a normalized insert-only run list.
  #
  # This is a Delta "compose" (unlike TextOT.transform, which reconciles two *concurrent*
  # diffs against each other, this applies a single diff directly onto the current
  # document) and, unlike the old plain-string merge, it keeps each run's attributes intact
  # instead of collapsing every run down to bare text — a reload or resync must see the same
  # bold/italic/etc. formatting a still-connected client does (see PR #55 review).
  #
  # Lengths and slicing are UTF-16-code-unit-based (see Utf16Text) so retain/delete offsets
  # from a browser client land on the same character Ruby does, even across the BMP/astral
  # boundary. retain/delete are already validated to be positive integers (see
  # validate_text_crdt_op!); reaching the end of doc_ops while incoming_ops still wants to
  # retain/delete more is rejected outright rather than silently truncated.
  def compose_text_crdt_ops(doc_ops, incoming_ops)
    a_ops = doc_ops.map(&:dup)
    b_ops = incoming_ops.map(&:dup)

    a_idx = 0
    b_idx = 0
    a_rem = a_ops[a_idx]
    b_rem = b_ops[b_idx]
    result = []

    while a_rem || b_rem
      if b_rem && b_rem["insert"]
        result << { "insert" => b_rem["insert"], "attributes" => b_rem["attributes"] }.compact
        b_idx += 1
        b_rem = b_ops[b_idx]
        next
      end

      if b_rem.nil?
        result << { "insert" => a_rem["insert"], "attributes" => a_rem["attributes"] }.compact
        a_idx += 1
        a_rem = a_ops[a_idx]
        next
      end

      if a_rem.nil?
        raise InvalidOpValueError, "text_crdt op retains or deletes beyond the end of the document"
      end

      a_len = Utf16Text.length(a_rem["insert"])
      b_len = b_rem["retain"] || b_rem["delete"]
      min_len = [ a_len, b_len ].min

      # min_len must land exactly on a character boundary within a_rem["insert"] — never
      # inside a UTF-16 surrogate pair (an astral character like most emoji). Slicing at a
      # mid-character offset would otherwise duplicate that character into both the
      # retained/deleted piece *and* the remainder (see PR #55 review); a legitimate
      # browser client operating on real cursor positions never produces such an offset, so
      # this can only happen from a malformed or malicious op.
      unless Utf16Text.valid_boundary?(a_rem["insert"], min_len)
        raise InvalidOpValueError, "text_crdt op offset splits a UTF-16 surrogate pair"
      end

      if b_rem["retain"]
        merged_attributes = merge_text_crdt_attributes(a_rem["attributes"], b_rem["attributes"])
        result << { "insert" => Utf16Text.slice(a_rem["insert"], 0, min_len), "attributes" => merged_attributes }.compact
      end
      # b_rem["delete"]: this span of the document is removed — nothing appended to result.

      if a_len > min_len
        a_rem = a_rem.merge("insert" => Utf16Text.slice(a_rem["insert"], min_len))
      else
        a_idx += 1
        a_rem = a_ops[a_idx]
      end

      if b_len > min_len
        key = b_rem["retain"] ? "retain" : "delete"
        b_rem = b_rem.merge(key => b_len - min_len)
      else
        b_idx += 1
        b_rem = b_ops[b_idx]
      end
    end

    normalize_text_crdt_document(result)
  end

  # A retain's attributes represent a formatting *change* over that span (e.g. "make this
  # bold"), applied on top of whatever the span already had — nil/absent incoming attributes
  # mean "no formatting change", not "clear formatting". Delta semantics use an explicit
  # `nil` value on a key (e.g. {"bold" => nil}) to mean "clear this attribute" rather than
  # "set it to null" — compact removes those keys after the merge so a resync doesn't leave
  # a dead {"bold" => nil} behind once formatting was explicitly cleared (see PR #55
  # review). The merged result is re-validated through the same bytesize/depth limits
  # incoming attributes are already held to, so repeated small merges across many separate
  # ops can't accumulate past those bounds.
  def merge_text_crdt_attributes(base_attributes, incoming_attributes)
    return base_attributes if incoming_attributes.blank?

    merged = (base_attributes || {}).merge(incoming_attributes).compact.presence
    validate_text_crdt_attributes!(merged) if merged
    merged
  end

  def normalize_text_crdt_document(ops)
    result = []
    ops.each do |op|
      next if op["insert"].nil? || op["insert"].empty?

      last = result.last
      if last && last["attributes"] == op["attributes"]
        last["insert"] += op["insert"]
      else
        result << op.dup
      end
    end
    result
  end

  def validate_text_crdt_attributes!(attributes, depth = 1)
    return unless attributes.is_a?(Hash)

    raise InvalidOpValueError, "text_crdt attributes must not exceed #{MAX_TEXT_CRDT_ATTRIBUTES_BYTES} bytes" if attributes.to_json.bytesize > MAX_TEXT_CRDT_ATTRIBUTES_BYTES
    raise InvalidOpValueError, "text_crdt attributes must not exceed depth #{MAX_TEXT_CRDT_ATTRIBUTES_DEPTH}" if depth > MAX_TEXT_CRDT_ATTRIBUTES_DEPTH

    attributes.each_value do |value|
      case value
      when Hash
        validate_text_crdt_attributes!(value, depth + 1)
      when Array
        value.each do |entry|
          validate_text_crdt_attributes!(entry, depth + 1)
        end
      end
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

      apply_mutation_for!(object, property, value, LEGACY_OP_CLIENT_ID, lamport_ts)
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

  # ref_revision is the server-assigned, persistence-order ObjectOp#id the client last saw
  # for this object's text_crdt property (returned as "revision" in a prior apply_op
  # response) — not a client-generated lamport_ts. lamport_ts is a per-client logical
  # counter, so comparing it across clients cannot establish a global history position: a
  # low-numbered op from a client that has advanced far ahead locally would be wrongly
  # treated as "already seen" and skipped from OT, corrupting the merge (see PR #55 review).
  # id is the table's auto-increment primary key, strictly increasing in insertion/commit
  # order, so "id > ref_revision" reliably means "everything recorded after what the client
  # last saw", regardless of which client produced it.
  def transform_text_crdt_ops(object_id, value, client_id)
    ops = value["ops"] || value[:ops]
    ref_revision = value["ref_revision"] || value[:ref_revision]
    # 0 is the dedicated "no history yet" baseline returned by serialize_object's
    # textCrdtRevision — treat it the same as an absent ref_revision below.
    ref_revision = nil if ref_revision == 0

    if ref_revision.nil?
      # A client may only skip OT entirely when this is genuinely the first text_crdt op
      # ever recorded for this object — otherwise it has no way to know whether another
      # client's edit landed first, and applying its ops blindly to whatever the object's
      # live state has become by now would silently corrupt the document.
      return ops unless ObjectOp.exists?(object_id: object_id, property: "text_crdt")

      raise OutdatedReferenceError, "ref_revision is required once text_crdt history exists for this object"
    end

    # ref_revision must actually be one of this object's own text_crdt ObjectOp ids —
    # otherwise a future/foreign/fabricated value would make the history query below
    # return an empty or incomplete conflict set, skipping OT against edits that genuinely
    # need to be transformed against.
    unless ObjectOp.exists?(id: ref_revision, object_id: object_id, property: "text_crdt")
      raise OutdatedReferenceError, "ref_revision #{ref_revision} does not refer to this object's text_crdt history"
    end

    conflicting_ops = ObjectOp.where(object_id: object_id, property: "text_crdt")
                               .where("id > ?", ref_revision)
                               .order(id: :asc)
                               .limit(MAX_OT_HISTORY_LIMIT + 1)
                               .to_a

    if conflicting_ops.size > MAX_OT_HISTORY_LIMIT
      raise OutdatedReferenceError, "ref_revision #{ref_revision} is too far behind (exceeds OT history limit of #{MAX_OT_HISTORY_LIMIT} ops)"
    end

    transformed_ops = ops
    conflicting_ops.each do |conf_op|
      conf_ops = conf_op.value.is_a?(Hash) ? (conf_op.value["ops"] || conf_op.value[:ops]) : nil
      next unless conf_ops.is_a?(Array)

      priority = client_id < conf_op.client_id
      transformed_ops = TextOT.transform(transformed_ops, conf_ops, priority)
    end

    transformed_ops
  end
end

# Browser clients measure/slice text_crdt string offsets as UTF-16 code units (JS string
# semantics: `"😀".length === 2`), while Ruby's String#length/#slice operate on Unicode
# codepoints (`"😀".length == 1`). For any character outside the Basic Multilingual Plane
# (astral characters — most emoji, some rare CJK) those two counts diverge, so retain/delete
# offsets computed by a browser and interpreted with plain Ruby string semantics land on the
# wrong character (see PR #55 review). This module measures and slices in UTF-16 code-unit
# space so offsets agree with what a browser client sent, regardless of BMP/astral mix.
module Utf16Text
  def self.length(str)
    str.each_char.sum { |ch| unit_width(ch) }
  end

  # Returns the substring covering UTF-16 code units [start, start + len) (or [start, end)
  # if len is nil). Only ever call this with start/(start+len) offsets already confirmed by
  # valid_boundary? to land on a whole character — calling it with an offset that splits a
  # surrogate pair silently includes or excludes that character wholesale rather than
  # actually cutting it in half, which duplicates or drops content (see PR #55 review).
  def self.slice(str, start, len = nil)
    result = +""
    units_seen = 0

    str.each_char do |ch|
      width = unit_width(ch)
      char_start = units_seen
      units_seen += width

      next if units_seen <= start
      break if !len.nil? && char_start >= start + len

      result << ch
    end

    result
  end

  # True only if offset (a UTF-16 code-unit count) falls exactly on a character boundary
  # within str — i.e. before the first character, after the last, or between two whole
  # characters. False for any offset that would land inside an astral character's surrogate
  # pair, or beyond the end of str.
  def self.valid_boundary?(str, offset)
    return true if offset == 0

    units_seen = 0
    str.each_char do |ch|
      units_seen += unit_width(ch)
      return true if units_seen == offset
      return false if units_seen > offset
    end

    false
  end

  def self.unit_width(ch)
    ch.ord > 0xFFFF ? 2 : 1
  end
  private_class_method :unit_width
end

class TextOT
  def self.transform(a_ops, b_ops, priority)
    a_idx = 0
    b_idx = 0

    a_op = a_ops[a_idx]
    b_op = b_ops[b_idx]

    a_rem = a_op ? clone_op(a_op) : nil
    b_rem = b_op ? clone_op(b_op) : nil

    transformed = []

    while a_rem || b_rem
      if !a_rem
        break
      end
      if !b_rem
        transformed << a_rem
        a_idx += 1
        a_rem = a_ops[a_idx] ? clone_op(a_ops[a_idx]) : nil
        next
      end

      a_type = op_type(a_rem)
      b_type = op_type(b_rem)

      a_len = op_len(a_rem)
      b_len = op_len(b_rem)

      if a_type == :insert && b_type == :insert
        if priority
          transformed << clone_op(a_rem)
          a_idx += 1
          a_rem = a_ops[a_idx] ? clone_op(a_ops[a_idx]) : nil
        else
          transformed << { "retain" => b_len }
          b_idx += 1
          b_rem = b_ops[b_idx] ? clone_op(b_ops[b_idx]) : nil
        end
      elsif a_type == :insert
        transformed << clone_op(a_rem)
        a_idx += 1
        a_rem = a_ops[a_idx] ? clone_op(a_ops[a_idx]) : nil
      elsif b_type == :insert
        transformed << { "retain" => b_len }
        b_idx += 1
        b_rem = b_ops[b_idx] ? clone_op(b_ops[b_idx]) : nil
      else
        min_len = [ a_len, b_len ].min

        if a_type == :retain && b_type == :retain
          # a_rem is *our own* op being transformed; its attributes (e.g. a formatting
          # change like bold:true) represent an intent that must survive transformation
          # against a concurrent op, not just the plain retain length. Dropping them here
          # silently discarded the user's own formatting edit whenever it overlapped
          # another client's concurrent op (see PR #55 review). b_rem's attributes are
          # deliberately not consulted: whichever attribute change actually lands last in
          # commit order already wins once compose_text_crdt_ops merges this transformed
          # retain onto the current document (last-write-wins per key, consistent with how
          # every other property in this system resolves concurrent writes) — b_rem's own
          # op (if it carried attributes) already applied directly, in its own right, when
          # *it* was originally composed onto the document before this transform even ran.
          transformed << { "retain" => min_len, "attributes" => op_attributes(a_rem) }.compact
        elsif a_type == :delete && b_type == :delete
          # no-op
        elsif a_type == :delete && b_type == :retain
          transformed << { "delete" => min_len }
        elsif a_type == :retain && b_type == :delete
          # no-op
        end

        consume!(a_rem, min_len)
        consume!(b_rem, min_len)

        if op_len(a_rem) == 0
          a_idx += 1
          a_rem = a_ops[a_idx] ? clone_op(a_ops[a_idx]) : nil
        end
        if op_len(b_rem) == 0
          b_idx += 1
          b_rem = b_ops[b_idx] ? clone_op(b_ops[b_idx]) : nil
        end
      end
    end

    normalize(transformed)
  end

  private

  def self.op_type(op)
    if op.key?("insert") || op.key?(:insert) then :insert
    elsif op.key?("delete") || op.key?(:delete) then :delete
    elsif op.key?("retain") || op.key?(:retain) then :retain
    end
  end

  def self.op_len(op)
    if op.key?("insert") || op.key?(:insert) then Utf16Text.length(op["insert"] || op[:insert])
    elsif op.key?("delete") || op.key?(:delete) then (op["delete"] || op[:delete]).to_i
    elsif op.key?("retain") || op.key?(:retain) then (op["retain"] || op[:retain]).to_i
    end
  end

  def self.op_attributes(op)
    op["attributes"] || op[:attributes]
  end

  def self.clone_op(op)
    op.dup.transform_keys(&:to_s)
  end

  def self.consume!(op, len)
    if op.key?("insert")
      op["insert"] = Utf16Text.slice(op["insert"], len)
    elsif op.key?("delete")
      op["delete"] = op["delete"].to_i - len
    elsif op.key?("retain")
      op["retain"] = op["retain"].to_i - len
    end
  end

  def self.normalize(ops)
    result = []
    ops.each do |op|
      next if op_len(op) == 0

      last = result.last
      # Only merge adjacent ops of the same type when their attributes are also identical
      # (including both being absent) — otherwise a later op's formatting (e.g. italic on
      # one insert vs. bold on the next) is silently discarded by folding it into the prior
      # op's attributes (see PR #55 review).
      if last && op_type(last) == op_type(op) && op_attributes(last) == op_attributes(op)
        if op_type(op) == :insert
          last["insert"] += op["insert"]
        elsif op_type(op) == :delete
          last["delete"] += op["delete"]
        elsif op_type(op) == :retain
          last["retain"] += op["retain"]
        end
      else
        result << op
      end
    end

    # A trailing plain retain is redundant (Delta convention: an op list implicitly retains
    # whatever it doesn't mention) and safe to drop. A trailing retain *with* attributes is
    # not redundant — it is the only thing carrying a formatting change over the rest of the
    # document (e.g. the retain/retain transform branch above, when the transformed op
    # happens to end on one) — dropping it here would silently discard that formatting
    # change (see PR #55 review).
    while result.last && op_type(result.last) == :retain && op_attributes(result.last).nil?
      result.pop
    end

    result
  end
end
