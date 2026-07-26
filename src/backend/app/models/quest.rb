class Quest < ApplicationRecord
  has_many :user_quests, dependent: :destroy

  validates :title, presence: true, uniqueness: true
  validates :condition_event, presence: true
  validates :condition_count, presence: true, numericality: { only_integer: true, greater_than: 0 }
end
