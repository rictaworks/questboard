class Comment < ApplicationRecord
  belongs_to :board_object, class_name: "BoardObject", foreign_key: :object_id, inverse_of: :comments
  belongs_to :user

  validates :body, presence: true
end
