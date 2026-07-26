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
      render json: { error: "Cannot skip quest" }, status: :unprocessable_entity
    end
  end

  def reopen
    service = QuestProgressService.new(current_user)
    if service.reopen_quest(params[:id], @board)
      user_quest = find_user_quest(params[:id])
      render json: { success: true, snapshot: user_quest.snapshot }
    else
      render json: { error: "Cannot reopen quest" }, status: :unprocessable_entity
    end
  end

  def claim
    service = QuestProgressService.new(current_user)
    if service.claim_reward(params[:id], @board)
      user_quest = find_user_quest(params[:id])
      render json: { success: true, snapshot: user_quest.snapshot }
    else
      render json: { error: "Cannot claim reward" }, status: :unprocessable_entity
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
    @board = Board.find_by(share_token: share_token)
    if @board
      @board.member_for!(current_user)
    else
      render json: { error: "Board not found" }, status: :not_found
    end
  end
end
