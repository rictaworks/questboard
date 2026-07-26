require "rails_helper"

RSpec.describe QuestProgressService, type: :service do
  let(:user) { User.create!(google_sub: "test-sub-12345", display_name: "Test User") }
  let(:board) { Board.create!(title: "Test Board") }
  let(:service) { described_class.new(user) }

  before do
    # クエストデータの準備
    Quest.find_or_create_by!(title: "付箋を3枚作る") do |q|
      q.condition_event = "object_created_sticky"
      q.condition_count = 3
    end
  end

  describe "#advance_for_event" do
    it "creates onboarding quests in not_started on first run" do
      service.ensure_user_quests
      uq = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(uq).not_to be_nil
      expect(uq.state).to eq("not_started")
    end

    it "advances progress on matching event" do
      service.advance_for_event("object_created_sticky", board)
      uq = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(uq.progress).to eq(1)
      expect(uq.state).to eq("in_progress")
    end

    it "automatically completes quest when target is reached" do
      3.times { service.advance_for_event("object_created_sticky", board) }
      uq = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(uq.progress).to eq(3)
      expect(uq.state).to eq("completed")
      expect(uq.completed_at).not_to be_nil
    end

    # 指摘5に対応した原子性・並行性競合テスト
    it "processes concurrent events atomically without losing progress" do
      service.ensure_user_quests
      user_quest = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(user_quest.progress).to eq(0)

      # 3つの並行スレッドで同時にイベントを進める
      threads = []
      3.times do
        threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            # 新しいスレッドから行ロックを伴う処理を実行
            QuestProgressService.new(user).advance_for_event("object_created_sticky", board)
          end
        end
      end
      threads.each(&:join)

      user_quest.reload
      expect(user_quest.progress).to eq(3)
      expect(user_quest.state).to eq("completed")
    end
  end

  describe "#advance_for_event broadcast targeting" do
    let(:other_board) { Board.create!(title: "Other Board") }

    before do
      role = Role.find_or_create_by!(code: "editor")
      BoardMember.create!(board: board, user: user, role: role)
      BoardMember.create!(board: other_board, user: user, role: role)
    end

    it "broadcasts the quest update only to the originating board, not every board the user belongs to" do
      fake_relay = instance_double(SyncOpRelay)
      allow(SyncOpRelay).to receive(:new).and_return(fake_relay)
      expect(fake_relay).to receive(:publish).once do |board_share_token:, object_op:|
        expect(board_share_token).to eq(board.share_token)
      end

      service.advance_for_event("object_created_sticky", board)
    end

    it "does not leak the personal quest snapshot (title/progress/dates) onto the shared board channel" do
      captured = nil
      fake_relay = instance_double(SyncOpRelay)
      allow(SyncOpRelay).to receive(:new).and_return(fake_relay)
      allow(fake_relay).to receive(:publish) { |board_share_token:, object_op:| captured = object_op }

      service.advance_for_event("object_created_sticky", board)

      expect(captured.property).to eq("quest_state_changed")
      expect(captured.relay_object_id).to eq(user.id.to_s)

      # 実際に配信されるJSONそのものを検査する。opオブジェクトのフィールドだけを見ていると、
      # 将来 SyncOpRelay の封筒に個人情報フィールドが足された場合に検知できない。
      serialized = {
        objectId: captured.relay_object_id,
        property: captured.property,
        value: captured.value
      }.to_json

      expect(captured.value).to eq({})
      expect(serialized).not_to include("付箋を3枚作る")
      expect(serialized).not_to include("progress")
      expect(serialized).not_to include("completed")
    end

    # クライアントは objectId が自分のユーザーIDと一致する通知だけを処理する。ここが
    # Rubyの内部オブジェクトIDになっていると通知が永久に無視されるため、SyncOpRelay が
    # 実際に組み立てる封筒のレベルで検証する。
    it "publishes the user id as objectId in the envelope SyncOpRelay actually builds" do
      captured_payload = nil
      fake_redis = instance_double(Redis)
      allow(fake_redis).to receive(:publish) { |_channel, payload| captured_payload = payload }
      allow(SyncOpRelay).to receive(:new).and_return(SyncOpRelay.new(redis_client: fake_redis))

      service.advance_for_event("object_created_sticky", board)

      envelope = JSON.parse(captured_payload)
      expect(envelope.dig("op", "objectId")).to eq(user.id.to_s)
      expect(envelope.dig("op", "property")).to eq("quest_state_changed")
      expect(envelope.dig("op", "value")).to eq({})
    end
  end

  describe "#ensure_user_quests" do
    # 行がまだ存在しない状態では SELECT ... FOR UPDATE が何もロックしないため、
    # 新規ユーザーの GET /quests と最初のKPIイベントが並行すると両方が INSERT し、
    # 一方が一意制約違反で落ちる（PR #61 レビュー）。KPI側は after_commit 済みなので
    # そのイベントの進捗が恒久的に欠落し、元の操作にも500が返り得る。
    #
    # 相手の INSERT が先に確定した状態を、こちらが INSERT を試みる前に作る。
    # テスト環境の接続はスレッド間で共有されるため本物の別接続は張れないが、この行は
    # create_or_find_by! が張る savepoint の外で確定しているので、一意制約違反による
    # 巻き戻しでは消えない。つまり実際の競合と同じ「行は既にあるが自分の INSERT は落ちる」
    # 状態になる（savepoint の内側で作ると競合相手ごと巻き戻り、再現にならない）。
    def simulate_concurrent_insert!(state:, progress:)
      allow(Quest).to receive(:find_each).and_wrap_original do |original, *args, &block|
        original.call(*args) do |quest|
          UserQuest.create!(user: user, quest: quest, state: state, progress: progress)
          block.call(quest)
        end
      end
    end

    # 競合ウィンドウを実際に通ったか（保存を試みて競合で弾かれたか）を記録する。
    # 存在確認を先に行う find_or_create_by! に戻すと保存自体が走らずここが空になるため、
    # 「競合時に落ちる実装へ戻した」ことを検知できる。
    def track_conflicts!
      # has_many の insert_record は save!(validate: true) とキーワード引数で呼ぶため、
      # 位置引数だけを転送すると ArgumentError になる。
      allow_any_instance_of(UserQuest).to receive(:save!).and_wrap_original do |original, *args, **kwargs|
        original.call(*args, **kwargs)
      rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid => e
        conflicts << e
        raise
      end
    end

    let(:conflicts) { [] }

    it "recovers instead of raising when a concurrent transaction inserts the same row first" do
      simulate_concurrent_insert!(state: "in_progress", progress: 1)
      track_conflicts!

      expect { service.ensure_user_quests }.not_to raise_error
      expect(conflicts.size).to eq(1)
    end

    it "keeps the row the concurrent transaction created instead of duplicating or resetting it" do
      simulate_concurrent_insert!(state: "in_progress", progress: 1)

      service.ensure_user_quests

      user_quest = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(user_quest.state).to eq("in_progress")
      expect(user_quest.progress).to eq(1)
      expect(user.user_quests.count).to eq(Quest.count)
    end

    it "stays idempotent across repeated calls" do
      service.ensure_user_quests

      expect { service.ensure_user_quests }.not_to change { user.user_quests.count }
    end
  end

  describe "skip and reopen" do
    before do
      service.ensure_user_quests
    end

    it "allows skipping a quest" do
      success = service.skip_quest("付箋を3枚作る", board)
      expect(success).to be(true)
      uq = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(uq.state).to eq("skipped")
      expect(uq.skipped_at).not_to be_nil
    end

    it "allows reopening a skipped quest" do
      service.skip_quest("付箋を3枚作る", board)
      success = service.reopen_quest("付箋を3枚作る", board)
      expect(success).to be(true)
      uq = user.user_quests.find_by(quest: Quest.find_by(title: "付箋を3枚作る"))
      expect(uq.state).to eq("in_progress")
      expect(uq.skipped_at).to be_nil
    end
  end
end
