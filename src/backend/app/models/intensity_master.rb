class IntensityMaster < ApplicationRecord
  has_many :user_settings, foreign_key: :intensity_id, dependent: :restrict_with_error
end
