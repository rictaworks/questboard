class BoardLockResolver
  def self.for_chain(object)
    new(fetch_chain_objects(object))
  end

  def self.fetch_chain_objects(object)
    return [] unless object

    objects = []
    current = object
    visited = Set.new

    while current
      break if visited.include?(current.id)
      visited.add(current.id)

      objects << current

      parent = current.parent_frame
      break if parent.nil? || parent.deleted_at.present?

      current = parent
    end

    objects
  end

  def initialize(board_or_objects)
    objects = if board_or_objects.is_a?(Board)
                board_or_objects.board_objects.active.includes(:frame_lock)
    elsif board_or_objects.respond_to?(:to_a)
                board_or_objects.to_a
    else
                [ board_or_objects ].compact
    end

    @objects_by_id = objects.index_by(&:id)
  end

  def active_locks_in_chain(object)
    return [] unless object

    locks = []
    current = object
    visited = Set.new

    while current
      break if visited.include?(current.id)
      visited.add(current.id)

      locks << current.frame_lock if current.frame_lock.present?

      parent_id = current.parent_frame_id
      break if parent_id.nil?

      parent = @objects_by_id[parent_id] || current.parent_frame
      break if parent.nil? || parent.deleted_at.present?

      current = parent
    end

    locks
  end

  def effective_lock(object, current_user_id: nil)
    locks = active_locks_in_chain(object)
    return nil if locks.empty?

    # 祖先チェーン内に自分以外が保持するロックがあれば、それを優先して返す。
    # これにより、祖先frameが他人にロックされている間は、自分が直接ロックした
    # 子オブジェクトであっても effective_lock 上は「他人にロックされている」
    # 扱いになり、unlockアクションの認可(direct_lock?はtrueでもlock_holder?がfalse)
    # まで拒否される。祖先ロック中はサブツリー全体を凍結する仕様として意図的。
    if current_user_id
      other_lock = locks.find { |l| l.locked_by.to_s != current_user_id.to_s }
      return other_lock if other_lock
    end

    locks.first
  end

  def object_state(object, current_user_id:)
    return {} unless object

    lock = effective_lock(object, current_user_id:)
    {
      locked: lock.present?,
      locked_by_user_id: lock&.locked_by,
      current_user_id: current_user_id,
      lock_origin_object_id: lock&.object_id,
      direct_lock: object.frame_lock.present?,
      object_id: object.id
    }
  end
end
