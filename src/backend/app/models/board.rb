class Board < ApplicationRecord
  has_secure_token :share_token

  has_many :board_members, dependent: :destroy
  has_many :users, through: :board_members
  has_many :board_objects, class_name: "BoardObject", foreign_key: :board_id

  validates :title, presence: true

  def self.create_with_owner!(title:, owner:)
    transaction do
      board = create!(title:)
      board.board_members.create!(user: owner, role: Role.owner)
      board
    end
  end

  def join_member!(user:, role_code:)
    role = Role.find_by!(code: role_code.to_s)

    board_members.create_or_find_by!(user:) do |member|
      member.role = role
    end
  end

  def member_for!(user)
    board_members.includes(:role).find_by!(user:)
  end
end
