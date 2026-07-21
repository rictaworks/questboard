class BoardObject < ApplicationRecord
  self.table_name = "objects"

  belongs_to :board
  belongs_to :object_type
  belongs_to :color_palette, foreign_key: :color_id
  belongs_to :parent_frame, class_name: "BoardObject", optional: true
  has_one :frame_lock, foreign_key: :object_id, dependent: :destroy

  scope :active, -> { where(deleted_at: nil) }
end
