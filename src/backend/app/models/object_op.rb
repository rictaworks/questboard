class ObjectOp < ApplicationRecord
  self.table_name = "object_ops"

  belongs_to :board
  belongs_to :board_object, class_name: "BoardObject", foreign_key: :object_id, inverse_of: false
  belongs_to :user

  validates :property, presence: true
  validates :client_id, presence: true
  validates :lamport_ts, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
