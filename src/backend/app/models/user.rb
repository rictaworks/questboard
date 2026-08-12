class User < ApplicationRecord
  alias_attribute :google_sub, :x_user_id

  belongs_to :plan, optional: true

  validates :x_user_id, presence: true, uniqueness: true
  validates :display_name, presence: true

  has_many :user_quests, dependent: :destroy
  has_one :user_setting, foreign_key: :user_id, dependent: :destroy, inverse_of: :user

  def self.upsert_from_google_identity!(google_sub:, display_name:)
    upsert(
      { x_user_id: google_sub, display_name:, created_at: Time.current },
      unique_by: :index_users_on_x_user_id,
      update_only: %i[display_name]
    )

    find_by!(x_user_id: google_sub)
  end
end
