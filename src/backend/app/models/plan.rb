class Plan < ApplicationRecord
  has_many :users

  validates :code, presence: true, uniqueness: true

  def self.find_or_create_by_code!(code)
    plan = find_by(code: code)
    return plan if plan

    Rails.logger.warn("Plan with code '#{code}' is missing. Self-healing by creating the plan.")
    find_or_create_by!(code: code)
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => e
    Rails.logger.warn("Plan with code '#{code}' was created concurrently: #{e.class} - #{e.message}")
    find_by!(code: code)
  end
end
