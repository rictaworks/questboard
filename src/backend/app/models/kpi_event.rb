class KpiEvent < ApplicationRecord
  belongs_to :event_def
  belongs_to :user
  belongs_to :board

  after_commit :advance_user_quests, on: :create

  private

  def advance_user_quests
    min_id = KpiEvent.where(
      user_id: user_id,
      board_id: board_id,
      event_def_id: event_def_id,
      occurred_at: occurred_at
    ).minimum(:id)

    return if min_id && id != min_id

    QuestProgressService.new(user).advance_for_event(event_def.code, board)
  end
end
