class User < ApplicationRecord
  validates :google_sub, presence: true, uniqueness: true
  validates :display_name, presence: true

  has_many :user_quests, dependent: :destroy
  has_one :user_setting, foreign_key: :user_id, dependent: :destroy, inverse_of: :user

  def self.upsert_from_google_identity!(google_sub:, display_name:)
    upsert(
      { google_sub:, display_name:, created_at: Time.current },
      unique_by: :index_users_on_google_sub,
      update_only: %i[display_name]
    )

    find_by!(google_sub:)
  end
end
