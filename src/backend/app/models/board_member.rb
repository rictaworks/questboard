class BoardMember < ApplicationRecord
  belongs_to :board
  belongs_to :user
  belongs_to :role

  validates :user_id, uniqueness: { scope: :board_id }
end
