class CommentsController < ApplicationController
  class KpiEventConfigurationError < StandardError; end

  before_action :require_current_user!

  def index
    board = find_board!
    comments = find_authorized_comments!(board:, action: :view_comments)
    return if performed?

    render json: { comments: comments.map { |comment| serialize_comment(comment) } }
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  end

  def create
    board = find_board!
    object = find_board_object!(board)
    return unless authorize_comment_access!(board:, action: :create_comment)

    comment = nil
    Comment.transaction do
      comment = object.comments.create!(
        user: current_user,
        body: normalized_comment_body
      )
      record_comment_kpi_event!(board:, comment:)
    end

    render json: serialize_comment(comment), status: :created
  rescue ActionController::ParameterMissing => e
    render json: { error: parameter_missing_message(e) }, status: :unprocessable_content
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_content
  rescue KpiEventConfigurationError => e
    logger.error("[CommentsController#create] #{e.message}")
    render json: { error: "Comment could not be recorded" }, status: :internal_server_error
  end

  def update
    comment = find_authorized_comment!(action: :edit_comment)
    return if performed?

    comment.update!(body: normalized_comment_body)
    render json: serialize_comment(comment)
  rescue ActionController::ParameterMissing => e
    render json: { error: parameter_missing_message(e) }, status: :unprocessable_content
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_content
  end

  def destroy
    comment = find_authorized_comment!(action: :delete_comment)
    return if performed?

    comment.destroy!
    head :no_content
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board or object not found" }, status: :not_found
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  def find_board!
    Board.active.find_by!(share_token: params.require(:share_token))
  end

  def find_board_object!(board)
    board.board_objects.active.find(params.require(:object_id))
  end

  def find_board_comment!(object)
    object.comments.find(params.require(:id))
  end

  def find_authorized_comments!(board:, action:)
    membership = board_membership_for(board)
    unless membership && PermissionService.new.authorize(membership.role.code, action, {})
      head :forbidden
      return []
    end

    object = find_board_object!(board)
    object.comments.includes(:user).order(:created_at, :id)
  end

  def find_authorized_comment!(action:)
    board = find_board!
    object = find_board_object!(board)
    comment = find_board_comment!(object)
    return unless authorize_comment_access!(board:, action:, comment:)

    comment
  end

  def authorize_comment_access!(board:, action:, comment: nil)
    membership = board_membership_for(board)
    unless membership
      head :forbidden
      return false
    end

    state = comment ? { comment_author_id: comment.user_id, actor_id: current_user.id } : {}
    return true if PermissionService.new.authorize(membership.role.code, action, state)

    head :forbidden
    false
  end

  def board_membership_for(board)
    board.board_members.includes(:role).find_by(user: current_user)
  end

  # body が無い場合も空文字として扱い、Comment の presence バリデーションに判定を任せる。
  # ここで ParameterMissing を投げると「本文が空」という同じ事象に対して
  # RecordInvalid とは別の応答経路ができ、両方が同じ文言を返し続ける保証が必要になる。
  #
  # ただし JSON の値は文字列とは限らない。配列やハッシュをそのまま to_s すると
  # "[]" や "{\"a\" => \"b\"}" という空でない文字列になり、空判定を通り抜けて本文として
  # 保存される（更新では既存の本文を破壊する）。文字列以外は本文が無いものとして扱う。
  def normalized_comment_body
    body = params[:body]
    unless body.is_a?(String)
      logger.warn("[CommentsController##{action_name}] body is not a string: #{body.class}") unless body.nil?
      return ""
    end

    body.strip
  end

  # 到達するのは share_token / object_id / id が欠けた場合だけで、これらはルーティング上の
  # パスパラメータのため通常このアクションには届かない。想定外の経路なので、
  # e.message（英語かつ内部のパラメータ名を含む）は利用者に見せずログにだけ残す。
  def parameter_missing_message(error)
    logger.warn("[CommentsController##{action_name}] parameter missing: #{error.param}")

    I18n.t("api.errors.parameter_missing")
  end

  def record_comment_kpi_event!(board:, comment:)
    event_def = EventDef.find_by(code: "comment_created")
    raise KpiEventConfigurationError, "EventDef with code 'comment_created' is not seeded" unless event_def

    KpiEvent.create!(
      event_def:,
      user: current_user,
      board:,
      props: {
        comment_id: comment.id,
        object_id: comment.object_id
      },
      occurred_at: comment.created_at
    )
  end

  def serialize_comment(comment)
    {
      id: comment.id,
      objectId: comment.object_id,
      userId: comment.user_id,
      userDisplayName: comment.user.display_name,
      body: comment.body,
      createdAt: comment.created_at.iso8601
    }
  end
end
