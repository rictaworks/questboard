class BoardObject < ApplicationRecord
  self.table_name = "objects"
  TOMBSTONE_RETENTION = 30.days

  belongs_to :board
  belongs_to :object_type
  belongs_to :color_palette, foreign_key: :color_id
  belongs_to :parent_frame, class_name: "BoardObject", optional: true
  has_one :frame_lock, foreign_key: :object_id, dependent: :destroy
  has_many :comments, foreign_key: :object_id, dependent: :destroy, inverse_of: :board_object

  scope :active, -> { where(deleted_at: nil) }
  scope :tombstones, -> { where.not(deleted_at: nil) }
  scope :purgeable_tombstones, ->(now = Time.current) { tombstones.where(arel_table[:deleted_at].lteq(now - TOMBSTONE_RETENTION)) }

  validate :parent_frame_must_belong_to_same_board

  def active_locks_in_chain
    BoardLockResolver.new(self).active_locks_in_chain(self)
  end

  def effective_frame_lock(current_user_id: nil)
    BoardLockResolver.new(self).effective_lock(self, current_user_id:)
  end

  private

  def parent_frame_must_belong_to_same_board
    return unless will_save_change_to_parent_frame_id?
    return if parent_frame_id.blank?

    parent = board&.board_objects&.active&.find_by(id: parent_frame_id) || BoardObject.active.find_by(id: parent_frame_id)
    if parent.nil? || parent.board_id != board_id || parent.object_type&.code != "frame"
      errors.add(:parent_frame_id, "must be a valid active frame on the same board")
    end
  end
end
