class BoardsController < ApplicationController
  class InvalidBoardTitleError < StandardError; end

  before_action :require_current_user!
  before_action :require_feature_plan!, except: :index

  class BoardDeletionRelayOp
    attr_reader :relay_object_id, :property, :value, :lamport_ts, :client_id

    def initialize(board_id:, deleted_at:)
      @relay_object_id = board_id
      @property = "board_deleted"
      @value = {}
      @lamport_ts = deleted_at.to_i
      @client_id = "legacy"
    end
  end

  def show
    board = find_board!
    membership = board_membership_for(board)
    return unless authorize_board_view!(board:, membership:)

    render json: serialize_canvas_board(board, membership)
  end

  def index
    memberships_scope = current_user.board_members
      .joins(:board)
      .where(boards: { deleted_at: nil })

    page, per_page = pagination_params
    total_count = memberships_scope.count
    total_pages = total_count.zero? ? 0 : (total_count.to_f / per_page).ceil
    memberships = memberships_scope
      .includes(:board, :role)
      .order("boards.updated_at DESC", "boards.id DESC")
      .limit(per_page)
      .offset((page - 1) * per_page)

    render json: {
      boards: memberships.map { |membership| serialize_board_list_item(membership) },
      pagination: {
        page:,
        perPage: per_page,
        totalCount: total_count,
        totalPages: total_pages,
        previousPage: page > 1 ? page - 1 : nil,
        nextPage: page < total_pages ? page + 1 : nil
      }
    }
  end

  def create
    board = nil
    Board.transaction do
      board = Board.create_with_owner!(title: normalized_board_title, owner: current_user)
      event_def = EventDef.find_by(code: "board_shared")
      if event_def
        KpiEvent.create!(
          event_def:,
          user: current_user,
          board:,
          props: { source: "board-create" },
          occurred_at: board.created_at
        )
      end
    end
    render json: serialize_board(board, board.member_for!(current_user)), status: :created
  end

  def join
    board = find_board!
    role_code = invite_role_code

    unless Role.assignable_from_invite?(role_code)
      raise ApplicationController::UnsupportedInviteRoleError
    end

    membership = board.join_member!(user: current_user, role_code:)
    render json: serialize_board(board, membership), status: :created
  end

  def update_member_role
    board = find_board!
    actor_member = board.board_members.includes(:role).find_by(user: current_user) || raise(ApplicationController::BoardNotFoundError)

    unless PermissionService.new.authorize(actor_member.role.code, :change_role, {})
      head :forbidden
      return
    end

    # user_id も share_token と同じくパスセグメント（routes.rb の :user_id）。require で
    # ActionController::ParameterMissing を起こすと、空白セグメントが 422「必要な項目が
    # 指定されていません」に化けてしまい、本来の 404「Board not found」に届かなくなる
    # （find_board! の share_token と同じ理由）。
    user_id = params[:user_id]
    role = Role.find_by(code: role_code_param) || raise(ApplicationController::BoardNotFoundError)

    board.with_lock do
      target_member = board.board_members.includes(:role).find_by!(user_id:)

      if demotes_last_owner?(board:, target_member:, new_role: role)
        raise ApplicationController::CannotRemoveLastOwnerError
      end

      target_member.update!(role:)
      render json: serialize_board(board, target_member)
    end
  end

  def destroy
    board = find_board!
    membership = board_membership_for(board)
    raise ApplicationController::BoardNotFoundError unless membership

    unless PermissionService.new.authorize(membership.role.code, :delete_board, {})
      head :forbidden
      return
    end

    deleted_at = board.tombstone!
    notify_board_deleted(board:, deleted_at:)
    head :no_content
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  # share_token は routes.rb のパスセグメントで、欠けたリクエストはこのコントローラに
  # 届かない。require で ActionController::ParameterMissing を起こすと、空白だけの
  # セグメント（"%20" 等）まで「必要な項目が指定されていません」（422）に化けてしまい、
  # 本来の「ボードが見つからない」（404）に届かなくなる（CommentsController#find_board! と
  # 同じ理由）。見つからない場合の RecordNotFound に一本化する。
  # show/join/update_member_role/destroy の全アクションがこのメソッドを経由する
  # （検索ロジックを変更する際はここ1箇所を直せば全アクションに反映される）。
  def find_board!
    Board.active.find_by(share_token: params[:share_token]) || raise(ApplicationController::BoardNotFoundError)
  end

  # title が無い場合は空文字として扱い、Board の presence バリデーションに判定を任せる。
  # fetch で ActionController::ParameterMissing を投げると、その文言
  # "param is missing or the value is empty or invalid: title" がそのまま応答に出る。
  # 利用者から見れば空白を送った場合と同じ「タイトルが無い」事象なのに、キーが欠けたときだけ
  # 英語（しかも内部のパラメータ名入り）という割れ方をしていた。
  #
  # 一方、値の型が違う場合は「空」ではない。真偽値や数値は文字列に寄せられて "t" や "0"
  # という空でない値として保存されてしまう。配列やハッシュは params.permit が非スカラーと
  # して黙って落とすため、送っているのに「入力してください」と返ることになり、利用者は
  # 原因にたどり着けない。空とは区別できる文言を返す（コメント本文と同じ扱い）。
  #
  # permit を通さず生の params を見るのは、落とされた値と未指定を見分けるため。
  # title は個別に渡していて一括代入はしないため、permit による防御は要らない。
  #
  # キーそのものが無い場合（{"boardTitle": "..."} のようなキー名の取り違え等）は、
  # 空欄で送った場合と応答は同じ「タイトルを入力してください」になるが、原因の調査には
  # ならない。invalid_title_message がキーは字面の異なる場合をログに残すのに対し、
  # ここは何もログを出していなかったので揃える。
  def normalized_board_title
    unless params.key?(:title)
      logger.warn("[BoardsController##{action_name}] title key missing from params")
      return ""
    end

    title = params[:title]
    return "" if title.nil?
    raise InvalidBoardTitleError, "expected String but got #{title.class}" unless title.is_a?(String)

    title.strip
  end

  def invite_role_code
    params[:role_code].presence || "viewer"
  end

  def role_code_param
    params.require(:role_code)
  end

  def demotes_last_owner?(board:, target_member:, new_role:)
    return false unless target_member.role.code == "owner"
    return false if new_role.code == "owner"

    !board.board_members
      .joins(:role)
      .where(roles: { code: "owner" })
      .where.not(id: target_member.id)
      .exists?
  end

  def serialize_board(board, membership)
    {
      board: serialize_board_attributes(board),
      membership: serialize_membership(membership)
    }
  end

  def serialize_canvas_board(board, membership)
    active_objects = board.board_objects.active.includes(:object_type, :frame_lock).order(:id).to_a
    resolver = BoardLockResolver.new(active_objects)
    can_view_comments = PermissionService.new.authorize(membership.role.code, :view_comments, {})
    comments = if can_view_comments
      board.comments.includes(:user).where(object_id: active_objects.map(&:id)).order(:created_at, :id).to_a
    else
      []
    end
    comment_counts = comments.each_with_object(Hash.new(0)) do |comment, memo|
      memo[comment.object_id] += 1
    end

    {
      board: serialize_board_attributes(board),
      membership: serialize_membership(membership),
      # クライアントの Lamport カウンタの初期値。これを返さないと再読み込み直後の
      # クライアントが 0 から採番し、履歴のあるプロパティへの編集が LWW で拒否される
      # （Issue #86）。
      lamportTs: board.latest_lamport_ts,
      objectTypes: ObjectType.order(:id).map { |type| { id: type.id, code: type.code } },
      colorPalettes: ColorPalette.order(:id).map { |color| { id: color.id, hex: color.hex } },
      comments: comments.map { |comment| serialize_comment(comment) },
      objects: active_objects.map { |object| serialize_board_object(object, resolver, comment_counts, can_view_comments) }
    }
  end

  def serialize_board_object(object, resolver, comment_counts, can_view_comments)
    lock = resolver.effective_lock(object, current_user_id: current_user&.id)

    {
      id: object.id,
      boardId: object.board_id,
      objectTypeCode: object.object_type.code,
      colorId: object.color_id,
      parentFrameId: object.parent_frame_id,
      geometry: object.geometry,
      textCrdt: object.text_crdt,
      # Read straight off the already-loaded row (no extra query, no N+1) — see
      # ObjectsController#serialize_object for why this must be the persisted column rather
      # than a computed ObjectOp.maximum(:id) query. Without this, a client that only ever
      # loads objects through the board endpoint (rather than a per-object fetch) would have
      # no way to obtain a valid ref_revision, and its first text_crdt edit would always be
      # rejected as resync-required with no way to recover (see PR #55 review).
      textCrdtRevision: object.text_crdt_revision,
      deletedAt: object.deleted_at&.iso8601,
      locked: lock.present?,
      lockedByUserId: lock&.locked_by,
      lockedAt: lock&.locked_at&.iso8601,
      lockOriginObjectId: lock&.object_id,
      commentCount: can_view_comments ? comment_counts.fetch(object.id, 0) : nil
    }
  end

  def serialize_board_attributes(board)
    {
      id: board.id,
      title: board.title,
      shareToken: board.share_token
    }
  end

  def serialize_board_list_item(membership)
    board = membership.board

    {
      id: board.id,
      title: board.title,
      shareToken: board.share_token,
      updatedAt: board.updated_at.iso8601,
      roleCode: membership.role.code
    }
  end

  def serialize_membership(membership)
    {
      userId: membership.user_id,
      role: {
        id: membership.role.id,
        code: membership.role.code
      }
    }
  end

  def board_membership_for(board)
    board.board_members.includes(:role).find_by(user: current_user)
  end

  def pagination_params
    page = params.fetch(:page, 1).to_i
    page = 1 if page < 1

    per_page = params.fetch(:per_page, 20).to_i
    per_page = 20 if per_page < 1
    per_page = 100 if per_page > 100

    [ page, per_page ]
  end

  def authorize_board_view!(board:, membership:)
    return true if membership && PermissionService.new.authorize(membership.role.code, :view_board, {})

    head :forbidden
    false
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

  def notify_board_deleted(board:, deleted_at:)
    SyncOpRelay.new.publish(
      board_share_token: board.share_token,
      object_op: BoardDeletionRelayOp.new(board_id: board.id, deleted_at:)
    )
  rescue SyncOpRelay::PublishError => e
    Rails.logger.error("SyncOpRelay publish failed for board=#{board.id}: #{e.cause&.class || e.class}")
  end
end
