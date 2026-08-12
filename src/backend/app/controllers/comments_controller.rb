class CommentsController < ApplicationController
  class KpiEventConfigurationError < StandardError; end
  class InvalidCommentBodyError < StandardError; end

  before_action :require_current_user!

  def index
    board = find_board!
    comments = find_authorized_comments!(board:, action: :view_comments)
    return if performed?

    render json: { comments: comments.map { |comment| serialize_comment(comment) } }
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
  end

  def update
    comment = find_authorized_comment!(action: :edit_comment)
    return if performed?

    comment.update!(body: normalized_comment_body)
    render json: serialize_comment(comment)
  end

  def destroy
    comment = find_authorized_comment!(action: :delete_comment)
    return if performed?

    comment.destroy!
    head :no_content
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  # share_token / object_id / id は routes.rb のパスセグメントで、欠けたリクエストは
  # このコントローラに届かない。require で ActionController::ParameterMissing を
  # 起こしても到達不能な rescue が増えるだけなので、見つからない場合の RecordNotFound に
  # 一本化する。
  def find_board!
    Board.active.find_by(share_token: params[:share_token]) || raise(ApplicationController::BoardOrObjectNotFoundError)
  end

  def find_board_object!(board)
    board.board_objects.active.find_by(id: params[:object_id]) || raise(ApplicationController::BoardOrObjectNotFoundError)
  end

  def find_board_comment!(object)
    object.comments.find_by(id: params[:id]) || raise(ApplicationController::BoardOrObjectNotFoundError)
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

  # body が無い場合は空文字として扱い、Comment の presence バリデーションに判定を任せる。
  # ここで別の例外を投げると「本文が空」という同じ事象に対して RecordInvalid とは別の
  # 応答経路ができ、両方が同じ文言を返し続ける保証が必要になる。
  #
  # 一方、値の型が違う場合は「空」ではない。JSON の値は文字列とは限らず、配列やハッシュを
  # そのまま to_s すると "[]" や "{\"a\" => \"b\"}" という空でない文字列になって本文として
  # 保存されてしまう（更新では既存の本文を破壊する）。かといって空として扱うと、
  # 内容を送っているのに「コメントを入力してください」と返ることになり、利用者は原因に
  # たどり着けない。空とは区別できる文言を返す。
  #
  # キーそのものが無い場合（{"commentBody": "..."} のようなキー名の取り違え等）は、
  # 空欄で送った場合と応答は同じ「コメントを入力してください」になるが、原因の調査には
  # ならない。BoardsController#normalized_board_title がキーの欠落をログに残すのに対し、
  # ここは何もログを出していなかったので揃える。
  def normalized_comment_body
    unless params.key?(:body)
      logger.warn("[CommentsController##{action_name}] body key missing from params")
      return ""
    end

    body = params[:body]
    return "" if body.nil?
    raise InvalidCommentBodyError, "expected String but got #{body.class}" unless body.is_a?(String)

    body.strip
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
