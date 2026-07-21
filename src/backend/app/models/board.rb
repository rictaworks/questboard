class Board < ApplicationRecord
  has_secure_token :share_token

  has_many :board_members, dependent: :destroy
  has_many :users, through: :board_members

  validates :title, presence: true

  def self.create_with_owner!(title:, owner:)
    transaction do
      board = create!(title:)
      board.board_members.create!(user: owner, role: Role.owner)
      board
    end
  end

  def upsert_member!(user:, role_code:)
    role = Role.find_by!(code: role_code.to_s)

    board_members.find_or_initialize_by(user: user).tap do |member|
      member.role = role
      member.save!
    end
  end

  def member_for!(user)
    board_members.includes(:role).find_by!(user:)
  end
end
