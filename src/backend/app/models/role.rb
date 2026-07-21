class Role < ApplicationRecord
  CODES = %w[owner editor commenter viewer].freeze
  INVITE_CODES = %w[editor commenter viewer].freeze

  validates :code, presence: true, uniqueness: true, inclusion: { in: CODES }

  def self.owner
    find_by!(code: "owner")
  end

  def self.assignable_from_invite?(code)
    INVITE_CODES.include?(code.to_s)
  end
end
