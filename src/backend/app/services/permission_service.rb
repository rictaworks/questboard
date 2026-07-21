class PermissionService
  READ_ACTIONS = %i[
    view_board
    view_comments
  ].freeze

  OBJECT_MUTATION_ACTIONS = %i[
    create_object
    edit_object
    delete_object
  ].freeze

  COMMENT_CREATE_ACTIONS = %i[
    create_comment
    comment
  ].freeze

  COMMENT_SELF_MUTATION_ACTIONS = %i[
    edit_comment
    delete_comment
  ].freeze

  LOCK_SET_ACTIONS = %i[
    lock_frame
    lock
  ].freeze

  LOCK_RELEASE_ACTIONS = %i[
    unlock_frame
    unlock
  ].freeze

  BOARD_ADMIN_ACTIONS = %i[
    delete_board
    change_role
    role_change
  ].freeze

  SHARE_ACTIONS = %i[
    share_board
    share
  ].freeze

  ACTION_ALIASES = {
    view_board: :view_board,
    view: :view_board,
    read: :view_board,
    read_board: :view_board,
    inspect_board: :view_board,
    view_comments: :view_comments,
    read_comments: :view_comments,
    inspect_comments: :view_comments,
    create_object: :create_object,
    create_sticky: :create_object,
    create_shape: :create_object,
    create_text: :create_object,
    create_frame: :create_object,
    duplicate: :create_object,
    duplicate_object: :create_object,
    edit_object: :edit_object,
    move_object: :edit_object,
    resize_object: :edit_object,
    recolor_object: :edit_object,
    align: :edit_object,
    group: :edit_object,
    ungroup: :edit_object,
    delete_object: :delete_object,
    delete: :delete_object,
    remove_object: :delete_object,
    create_comment: :create_comment,
    comment: :create_comment,
    edit_comment: :edit_comment,
    delete_comment: :delete_comment,
    lock_frame: :lock_set,
    lock: :lock_set,
    unlock_frame: :lock_release,
    unlock: :lock_release,
    delete_board: :board_admin,
    board_delete: :board_admin,
    manage_board: :board_admin,
    board_manage: :board_admin,
    admin_board: :board_admin,
    change_role: :board_admin,
    role_change: :board_admin,
    share_board: :share_board,
    share: :share_board
  }.freeze

  def authorize(role, action, target_state = {})
    normalized_role = normalize_role(role)
    normalized_action = normalize_action(action)
    return false unless normalized_role && normalized_action

    state = normalize_target_state(target_state)

    return true if normalized_role == :owner
    return false if board_admin_action?(normalized_action)

    case normalized_role
    when :viewer
      read_action?(normalized_action)
    when :commenter
      commenter_allowed?(normalized_action, state)
    when :editor
      editor_allowed?(normalized_action, state)
    else
      false
    end
  end
  alias call authorize

  private

  def normalize_role(role)
    role.to_s.strip.downcase.to_sym if role
  end

  def normalize_action(action)
    action_key = action.to_s.strip.downcase.to_sym if action
    return unless action_key

    ACTION_ALIASES.fetch(action_key, action_key)
  end

  def normalize_target_state(target_state)
    (target_state || {}).each_with_object({}) do |(key, value), memo|
      memo[key.to_s.strip.downcase.to_sym] = value
    end
  end

  def read_action?(action)
    READ_ACTIONS.include?(action)
  end

  def comment_create_action?(action)
    COMMENT_CREATE_ACTIONS.include?(action)
  end

  def comment_self_mutation_action?(action)
    COMMENT_SELF_MUTATION_ACTIONS.include?(action)
  end

  def lock_set_action?(action)
    action == :lock_set
  end

  def lock_release_action?(action)
    action == :lock_release
  end

  def board_admin_action?(action)
    action == :board_admin
  end

  def share_action?(action)
    action == :share_board
  end

  def object_mutation_action?(action)
    OBJECT_MUTATION_ACTIONS.include?(action)
  end

  def commenter_allowed?(action, state)
    return true if read_action?(action)
    return true if comment_create_action?(action)
    return true if comment_self_mutation_action?(action) && self_comment?(state)

    false
  end

  def editor_allowed?(action, state)
    return true if read_action?(action)
    return true if comment_create_action?(action)
    return true if comment_self_mutation_action?(action)
    return true if share_action?(action)
    return true if lock_set_action?(action) && unlocked?(state)
    return true if lock_release_action?(action) && locked?(state) && lock_holder?(state)
    return true if object_mutation_action?(action) && object_editable?(state)

    false
  end

  def unlocked?(state)
    !truthy?(state[:locked])
  end

  def locked?(state)
    truthy?(state[:locked])
  end

  def lock_holder?(state)
    return true if truthy?(state[:locked_by_me]) || truthy?(state[:self_locked]) || truthy?(state[:lock_owner_matches_actor])

    actor_id = state[:actor_id] || state[:user_id] || state[:current_user_id]
    owner_id = state[:lock_owner_id] || state[:locked_by] || state[:locked_by_user_id] || state[:frame_lock_owner_id]
    actor_id && owner_id && actor_id.to_s == owner_id.to_s
  end

  def self_comment?(state)
    return true if truthy?(state[:self_comment]) || truthy?(state[:owned_by_actor])

    actor_id = state[:actor_id] || state[:user_id] || state[:current_user_id]
    author_id = state[:comment_author_id] || state[:author_id] || state[:comment_user_id]
    actor_id && author_id && actor_id.to_s == author_id.to_s
  end

  def object_editable?(state)
    return true unless locked?(state)
    return true if lock_holder?(state)

    false
  end

  def truthy?(value)
    value == true || value.to_s.downcase == "true"
  end
end
