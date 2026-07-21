class FrameLock < ApplicationRecord
  belongs_to :board_object, class_name: "BoardObject", foreign_key: :object_id
  belongs_to :locked_by_user, class_name: "User", foreign_key: :locked_by
end
