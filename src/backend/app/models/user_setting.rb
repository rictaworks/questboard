class UserSetting < ApplicationRecord
  self.primary_key = :user_id

  belongs_to :user
  belongs_to :intensity_master, foreign_key: :intensity_id
end
