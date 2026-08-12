class FollowerCache < ApplicationRecord
  self.table_name = "follower_cache"
  self.primary_key = "x_user_id"

  validates :fetched_at, presence: true
end
