class UserSetting < ApplicationRecord
  self.primary_key = :user_id

  belongs_to :user, inverse_of: :user_setting
  belongs_to :intensity_master, foreign_key: :intensity_id

  validates :intensity_master, presence: true
end
