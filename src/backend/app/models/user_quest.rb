class UserQuest < ApplicationRecord
  belongs_to :user
  belongs_to :quest

  validates :state, presence: true, inclusion: { in: %w[not_started in_progress achieved reward_granted completed skipped] }
  validates :progress, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :user_id, uniqueness: { scope: :quest_id }

  def snapshot
    {
      id: quest.title,
      title: quest.title,
      conditionEvent: quest.condition_event,
      conditionCount: quest.condition_count,
      progress: progress,
      state: state,
      achievedAt: achieved_at&.iso8601,
      completedAt: completed_at&.iso8601,
      rewardGrantedAt: reward_granted_at&.iso8601,
      skippedAt: skipped_at&.iso8601
    }
  end
end
