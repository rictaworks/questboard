class User < ApplicationRecord
  belongs_to :plan

  before_validation :set_default_plan, on: :create

  validates :x_user_id, presence: true, uniqueness: true
  validates :display_name, presence: true

  has_many :user_quests, dependent: :destroy
  has_one :user_setting, foreign_key: :user_id, dependent: :destroy, inverse_of: :user

  def self.upsert_from_x_identity!(x_user_id:, display_name:, plan:)
    existing_user = find_by(x_user_id:)
    effective_plan = existing_user&.plan&.code == "member" && plan.code == "none" ? existing_user.plan : plan

    upsert(
      { x_user_id:, display_name:, plan_id: effective_plan.id, created_at: Time.current },
      unique_by: :index_users_on_x_user_id,
      update_only: %i[display_name plan_id]
    )

    find_by!(x_user_id:)
  end

  private

  def set_default_plan
    self.plan ||= Plan.find_or_create_by!(code: "none")
  end
end
