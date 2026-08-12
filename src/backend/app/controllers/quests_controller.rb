class QuestsController < ApplicationController
  before_action :require_current_user!
  before_action :find_board!, only: %i[skip reopen claim]

  def index
    service = QuestProgressService.new(current_user)
    service.ensure_user_quests

    render json: current_user.user_quests.includes(:quest).map(&:snapshot)
  end

  def skip
    service = QuestProgressService.new(current_user)
    if service.skip_quest(params[:id], @board)
      user_quest = find_user_quest(params[:id])
      render json: { success: true, snapshot: user_quest.snapshot }
    else
      raise ApplicationController::CannotSkipQuestError
    end
  end

  def reopen
    service = QuestProgressService.new(current_user)
    if service.reopen_quest(params[:id], @board)
      user_quest = find_user_quest(params[:id])
      render json: { success: true, snapshot: user_quest.snapshot }
    else
      raise ApplicationController::CannotReopenQuestError
    end
  end

  def claim
    service = QuestProgressService.new(current_user)
    if service.claim_reward(params[:id], @board)
      user_quest = find_user_quest(params[:id])
      render json: { success: true, snapshot: user_quest.snapshot }
    else
      raise ApplicationController::CannotClaimRewardError
    end
  end

  private

  def find_user_quest(quest_id)
    quest = Quest.find_by(id: quest_id) || Quest.find_by(title: quest_id)
    current_user.user_quests.find_by!(quest: quest)
  end

  def require_current_user!
    head :unauthorized unless current_user
  end

  def find_board!
    share_token = params[:share_token]
    @board = Board.find_by(share_token: share_token) || raise(ApplicationController::BoardNotFoundError)
    @board.member_for!(current_user)
  end
end
