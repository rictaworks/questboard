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

  def normalized_comment_body
    body = params.require(:body).to_s.strip
    raise ActionController::ParameterMissing, :body if body.blank?

    body
  end

  # body が空文字のときは Comment のバリデーション（RecordInvalid）が
  # blank_comment_body_message と同じ文言を返す。body キーごと欠落したときだけ別の文言に
  # なると、利用者から見て同じ「コメントが空」なのに理由の表示が変わってしまうため揃える。
  #
  # body 以外（share_token / object_id / id）はルーティング上のパスパラメータで、欠けた
  # リクエストはそもそもこのアクションに到達しない。到達した場合は想定外なので、
  # e.message（英語かつ内部のパラメータ名を含む）を利用者に見せず、ログにだけ残す。
  def parameter_missing_message(error)
    logger.warn("[CommentsController##{action_name}] parameter missing: #{error.param}")
    return blank_comment_body_message if error.param.to_s == "body"

    I18n.t("api.errors.parameter_missing")
  end

  # ja.yml の attribute 名と blank メッセージから組み立てる。ここで日本語を直書きすると
  # ja.yml を直したときにこの文字列だけ古いまま残る。
  def blank_comment_body_message
    I18n.t(
      "errors.format",
      attribute: Comment.human_attribute_name(:body),
      message: I18n.t("errors.messages.blank")
    )
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
