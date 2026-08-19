class BoardObject < ApplicationRecord
  self.table_name = "objects"
  TOMBSTONE_RETENTION = 30.days

  # 図形オブジェクトの形状（issue #200）。NULL は従来どおりの四角として描画する。
  # フロントは shapeKind を CSS クラス（board-object-shape--<kind>）へそのまま展開する
  # ため、この許可リスト以外の値を通さないこと。
  SHAPE_KINDS = %w[rectangle ellipse triangle].freeze

  belongs_to :board, touch: true
  belongs_to :object_type
  belongs_to :color_palette, foreign_key: :color_id
  belongs_to :parent_frame, class_name: "BoardObject", optional: true
  has_one :frame_lock, foreign_key: :object_id, dependent: :destroy
  has_many :comments, foreign_key: :object_id, dependent: :destroy, inverse_of: :board_object

  scope :active, -> { where(deleted_at: nil) }
  scope :tombstones, -> { where.not(deleted_at: nil) }
  scope :purgeable_tombstones, ->(now = Time.current) { tombstones.where(arel_table[:deleted_at].lteq(now - TOMBSTONE_RETENTION)) }

  validates :shape_kind, inclusion: { in: SHAPE_KINDS }, allow_nil: true
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
      # 文言は config/locales/ja.yml に置く。ここに直書きすると
      # errors.format（"%{attribute}%{message}"）と噛み合わず、項目名と繋がって表示される。
      errors.add(:parent_frame_id, :invalid_parent_frame)
    end
  end
end
