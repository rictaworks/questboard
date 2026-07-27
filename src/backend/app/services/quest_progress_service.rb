class QuestProgressService
  # SyncOpRelay#publish が期待するインターフェースだけを満たす軽量なop。クエスト通知は
  # object_ops テーブルに永続化しない（object_ops.object_id は NOT NULL かつ objects への
  # 外部キーであり、ユーザー単位の行を持てないため）ので、AR モデルの代わりにこれを渡す。
  #
  # 配信対象IDは object_id ではなく relay_object_id という名前で公開する。object_id は
  # Object に元から存在するため、以前の method_missing による動的委譲では委譲が発火せず、
  # ユーザーIDではなく Ruby の内部オブジェクトIDが配信されていた。その結果クライアント側の
  # objectId 一致判定が常に外れ、WebSocket通知が丸ごと無視されていた（PR #61）。
  class RelayOp
    attr_reader :relay_object_id, :property, :value, :lamport_ts, :client_id

    def initialize(relay_object_id:, property:, value:, lamport_ts:, client_id:)
      @relay_object_id = relay_object_id
      @property = property
      @value = value
      @lamport_ts = lamport_ts
      @client_id = client_id
    end
  end

  def initialize(user)
    @user = user
  end

  # 行がまだ存在しない状態では SELECT ... FOR UPDATE が何もロックしないため、
  # find_or_create_by! では新規ユーザーの GET /quests と最初のKPIイベントが並行したときに
  # 両方が INSERT し、一方が一意制約違反で落ちる。KPI側は after_commit 済みなので
  # そのイベントの進捗が恒久的に欠落し、元の操作にも500が返る（PR #61 レビュー）。
  #
  # 代わりに INSERT を先に試し、競合したら既存行を取り直す（冪等な初期化）。
  def ensure_user_quests
    # 既存ユーザーでは毎回のイベント処理で全クエスト分の INSERT を試すことになるため、
    # 揃っている分は事前に読んだIDで弾き、不足分だけを競合耐性のある経路に通す。
    existing_quest_ids = @user.user_quests.pluck(:quest_id).to_set

    Quest.find_each do |quest|
      next if existing_quest_ids.include?(quest.id)

      create_user_quest_idempotently(quest)
    end
  end

  def advance_for_event(event_code, board)
    ensure_user_quests

    quests = Quest.where(condition_event: event_code)
    return if quests.empty?

    quests.each do |quest|
      saved_quest = nil

      UserQuest.transaction do
        user_quest = UserQuest.lock.find_by(user: @user, quest: quest)
        next unless user_quest

        # すでに完了している、またはスキップされている場合は進めない
        next if %w[completed skipped].include?(user_quest.state)

        if user_quest.state == "not_started"
          user_quest.state = "in_progress"
        end

        user_quest.progress = [ user_quest.progress + 1, quest.condition_count ].min

        should_create_event = false
        if user_quest.progress >= quest.condition_count
          user_quest.state = "completed"
          user_quest.achieved_at ||= Time.current
          user_quest.reward_granted_at ||= Time.current
          user_quest.completed_at ||= Time.current
          should_create_event = true
        end

        if user_quest.save
          saved_quest = user_quest

          if should_create_event
            event_def = EventDef.find_by(code: "quest_completed")
            if event_def
              KpiEvent.create!(
                user: @user,
                board: board,
                event_def: event_def,
                occurred_at: Time.current,
                props: { quest_title: quest.title }
              )
            end
          end
        end
      end

      # コミット確定後にのみ配信する（トランザクション内配信だとロールバック時に未確定状態を通知してしまう）
      broadcast_quest_update(board, saved_quest) if saved_quest
    end
  end

  def skip_quest(quest_id, board)
    ensure_user_quests
    saved_quest = nil

    UserQuest.transaction do
      user_quest = find_user_quest_with_lock(quest_id)
      return false if %w[completed skipped].include?(user_quest.state)

      user_quest.state = "skipped"
      user_quest.skipped_at ||= Time.current
      saved_quest = user_quest if user_quest.save
    end

    return false unless saved_quest

    broadcast_quest_update(board, saved_quest)
    true
  end

  def reopen_quest(quest_id, board)
    ensure_user_quests
    saved_quest = nil

    UserQuest.transaction do
      user_quest = find_user_quest_with_lock(quest_id)
      return false unless user_quest.state == "skipped"

      user_quest.state = "in_progress"
      user_quest.skipped_at = nil
      saved_quest = user_quest if user_quest.save
    end

    return false unless saved_quest

    broadcast_quest_update(board, saved_quest)
    true
  end

  def claim_reward(quest_id, board)
    ensure_user_quests
    saved_quest = nil

    UserQuest.transaction do
      user_quest = find_user_quest_with_lock(quest_id)
      return false unless user_quest.state == "achieved" || user_quest.state == "completed"

      was_completed = user_quest.state == "completed"

      user_quest.state = "completed"
      user_quest.reward_granted_at ||= Time.current
      user_quest.completed_at ||= Time.current

      if !was_completed && user_quest.save
        saved_quest = user_quest
        event_def = EventDef.find_by(code: "quest_completed")
        if event_def
          KpiEvent.create!(
            user: @user,
            board: board,
            event_def: event_def,
            occurred_at: Time.current,
            props: { quest_title: user_quest.quest.title }
          )
        end
      elsif was_completed && user_quest.save
        saved_quest = user_quest
      end
    end

    return false unless saved_quest

    broadcast_quest_update(board, saved_quest)
    true
  end

  private

  # 競合相手の INSERT がこちらの uniqueness バリデーション時点で既に見えていれば
  # RecordInvalid、INSERT 実行時に初めて見えれば RecordNotUnique になる。
  # create_or_find_by! は後者しか握らないため、両方を明示的に扱う。
  #
  # INSERT 失敗は PostgreSQL では外側のトランザクションを中断させるので、
  # requires_new: true で savepoint に閉じ込めてから握る。
  # 例外を握るのは「相手が同じ行を作った」ケースだけに限定し、既存行を取り直せない場合は
  # 別の原因（バリデーション違反など）なのでそのまま送出する。
  def create_user_quest_idempotently(quest)
    UserQuest.transaction(requires_new: true) do
      @user.user_quests.create!(quest_id: quest.id, state: "not_started", progress: 0)
    end
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => e
    existing = @user.user_quests.find_by(quest_id: quest.id)
    raise e unless existing

    existing
  end

  def find_user_quest_with_lock(quest_id)
    quest = Quest.find_by(id: quest_id) || Quest.find_by(title: quest_id)
    raise ActiveRecord::RecordNotFound, "Quest not found with ID/Title: #{quest_id}" unless quest

    @user.user_quests.lock.find_by!(quest: quest)
  end

  # 個人のクエスト名・進捗・達成日時等はボード共有のRedisチャンネルへ流さない
  # （同じボードの他メンバーが生のWebSocketフレームから閲覧できてしまうため）。
  # 変更があったことだけを伝え、クライアントは認証済みの GET /quests から自分の状態を取得する。
  #
  # value は nil ではなく空ハッシュにすること。クライアントの parseRealtimeMessage は
  # オブジェクト以外の value を持つメッセージを一律で捨てるため、nil を送ると
  # この通知がハンドラまで届かずポーリング待ちになる（PR #61 レビュー参照）。
  def broadcast_quest_update(board_arg, user_quest)
    return unless board_arg

    object_op = RelayOp.new(
      relay_object_id: user_quest.user_id.to_s,
      property: "quest_state_changed",
      value: {},
      lamport_ts: Time.current.to_i,
      client_id: "system"
    )

    begin
      SyncOpRelay.new.publish(board_share_token: board_arg.share_token, object_op: object_op)
    rescue SyncOpRelay::PublishError => e
      Rails.logger.error("[QuestProgressService] Failed to broadcast quest update to board #{board_arg.id}: #{e.message}")
    end
  end
end
