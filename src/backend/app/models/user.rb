class User < ApplicationRecord
  belongs_to :plan

  before_validation :set_default_plan, on: :create

  validates :x_user_id, presence: true, uniqueness: true
  validates :display_name, presence: true

  has_many :user_quests, dependent: :destroy
  has_many :board_members, dependent: :destroy
  has_many :comments, dependent: :destroy
  has_many :frame_locks, foreign_key: :locked_by, dependent: :destroy
  has_many :object_ops, dependent: :nullify
  has_many :kpi_events, dependent: :nullify
  has_one :user_setting, foreign_key: :user_id, dependent: :destroy, inverse_of: :user

  # ログイン時にXの識別情報とプラン値を書き込む。
  #
  # plan / confirmed はフォロワー判定サービス（x-follower-gate）の応答から決まる（Issue #253）。
  #
  # - `confirmed: true` … 判定サービスがプラン値を確定した。**降格も反映する。**
  #   委譲後は questboard 側にフル同期が無く、ここが唯一の降格経路になる。
  # - `confirmed: false` … 判定サービスが X API の障害でプラン値を確定できていない
  #   （x-follower-gate requirements.md 8.5）。**既存のプラン値を据え置く。**
  # - `plan: nil` … 判定サービスへ到達できなかった。既存の利用者は据え置き、
  #   新規の利用者は none とする。**ログイン自体は成立させる**（設計書 4.3）。
  def self.upsert_from_x_identity!(x_user_id:, display_name:, plan:, confirmed: true)
    existing_user = find_by(x_user_id:)
    effective_plan = effective_plan_for(existing_user:, plan:, confirmed:)

    upsert(
      { x_user_id:, display_name:, plan_id: effective_plan.id, created_at: Time.current },
      unique_by: :index_users_on_x_user_id,
      update_only: %i[display_name plan_id]
    )

    find_by!(x_user_id:)
  end

  def self.effective_plan_for(existing_user:, plan:, confirmed:)
    return plan if plan.present? && confirmed
    return existing_user.plan if existing_user&.plan.present?

    # 新規の利用者で判定が確定していない場合は、機能を露出させない側へ倒す。
    plan.presence || Plan.find_or_create_by_code!("none")
  end
  private_class_method :effective_plan_for

  def member_plan?
    plan.code == "member"
  end

  def none_plan?
    plan.code == "none"
  end

  private

  def set_default_plan
    self.plan ||= Plan.find_or_create_by_code!("none")
  end
end
