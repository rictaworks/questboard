require "rails_helper"

RSpec.describe QuestProgressService, type: :service do
  self.use_transactional_tests = false

  let(:user_google_sub) { "test-sub-12345-#{SecureRandom.hex(4)}" }
  let(:board_title) { "Test Board-#{SecureRandom.hex(4)}" }
  let(:other_board_title) { "Other Board-#{SecureRandom.hex(4)}" }
  let(:quest_title) { "付箋を3枚作る-#{SecureRandom.hex(4)}" }

  let(:user) { @user }
  let(:board) { @board }
  let(:other_board) { @other_board }
  let(:quest) { @quest }
  let(:service) { described_class.new(user) }

  before do
    @user, @board, @other_board, @quest = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        user = User.create!(google_sub: user_google_sub, display_name: "Test User")
        board = Board.create!(title: board_title)
        other_board = Board.create!(title: other_board_title)
        quest = Quest.find_or_create_by!(title: quest_title) do |q|
          q.condition_event = "object_created_sticky"
          q.condition_count = 3
        end
        [ user, board, other_board, quest ]
      end
    end.value
  end

  after do
    KpiEvent.where(user_id: user.id).delete_all
    BoardMember.where(user_id: user.id).delete_all
    UserQuest.where(user_id: user.id).delete_all
    Board.where(title: [ board_title, other_board_title ]).delete_all
    User.where(google_sub: user_google_sub).delete_all
    Quest.where(title: quest_title).delete_all
  end

  describe "#advance_for_event" do
    it "creates onboarding quests in not_started on first run" do
      service.ensure_user_quests
      uq = user.user_quests.find_by(quest: quest)
      expect(uq).not_to be_nil
      expect(uq.state).to eq("not_started")
    end

    it "advances progress on matching event" do
      service.advance_for_event("object_created_sticky", board)
      uq = user.user_quests.find_by(quest: quest)
      expect(uq.progress).to eq(1)
      expect(uq.state).to eq("in_progress")
    end

    it "automatically completes quest when target is reached" do
      3.times { service.advance_for_event("object_created_sticky", board) }
      uq = user.user_quests.find_by(quest: quest)
      expect(uq.progress).to eq(3)
      expect(uq.state).to eq("completed")
      expect(uq.completed_at).not_to be_nil
    end

    # 指摘5に対応した原子性・並行性競合テスト
    it "processes concurrent events atomically without losing progress" do
      service.ensure_user_quests
      user_quest = user.user_quests.find_by(quest: quest)
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
    let(:other_board) { Board.create!(title: other_board_title) }

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
      expect(serialized).not_to include(quest_title)
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
    def insert_user_quest_in_open_transaction!(state:, progress:)
      ready = Queue.new
      user_id = user.id
      quest_id = quest.id

      thread = Thread.new do
        Thread.current.report_on_exception = false
        ActiveRecord::Base.connection_pool.with_connection do
          UserQuest.transaction do
            UserQuest.create!(user_id: user_id, quest_id: quest_id, state: state, progress: progress)
            ready << true
            sleep 0.2
          end
        end
      rescue StandardError => e
        ready << e
        raise
      end

      signal = ready.pop
      raise signal if signal.is_a?(Exception)
      thread
    end

    it "recovers when another PostgreSQL connection inserts the same row first" do
      thread = insert_user_quest_in_open_transaction!(state: "in_progress", progress: 1)

      expect { service.ensure_user_quests }.not_to raise_error
      thread.value

      user_quest = user.user_quests.find_by(quest: quest)
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
      success = service.skip_quest(quest_title, board)
      expect(success).to be(true)
      uq = user.user_quests.find_by(quest: quest)
      expect(uq.state).to eq("skipped")
      expect(uq.skipped_at).not_to be_nil
    end

    it "allows reopening a skipped quest" do
      service.skip_quest(quest_title, board)
      success = service.reopen_quest(quest_title, board)
      expect(success).to be(true)
      uq = user.user_quests.find_by(quest: quest)
      expect(uq.state).to eq("in_progress")
      expect(uq.skipped_at).to be_nil
    end
  end
end
