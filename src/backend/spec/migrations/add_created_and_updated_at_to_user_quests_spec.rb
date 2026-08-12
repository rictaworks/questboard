require "rails_helper"
require Rails.root.join("db/migrate/20260726143000_add_created_and_updated_at_to_user_quests").to_s

# 既存行がある状態への適用を再現し、タイムスタンプ列の追加とバックフィルの
# 退行を検知する。テストDBには既に適用済みなので、down で列を落としてから up を
# 実行し、マイグレーション本体の挙動を直接確認する。
RSpec.describe AddCreatedAndUpdatedAtToUserQuests do
  let(:migration) { described_class.new }
  let(:connection) { ActiveRecord::Base.connection }

  around do |example|
    ActiveRecord::Migration.suppress_messages do
      example.run
    ensure
      # 例外で終わっても別接続で列を必ず戻し、後続のspecに影響させない。
      Thread.new do
        Thread.current.report_on_exception = false
        ActiveRecord::Base.connection_pool.with_connection do |conn|
          unless conn.column_exists?(:user_quests, :created_at)
            ActiveRecord::Migration.suppress_messages { described_class.new.up }
          end
          UserQuest.reset_column_information
        end
      end.value
    end
  end

  def seed_user_quest!(state: "in_progress", progress: 2)
    user = User.create!(x_user_id: "x-sub-#{SecureRandom.hex(4)}", display_name: "Migration User")
    quest = Quest.find_or_create_by!(title: "マイグレーション検証クエスト") do |q|
      q.condition_event = "object_created_sticky"
      q.condition_count = 3
    end

    UserQuest.create!(user:, quest:, state:, progress:)
  end

  def rollback_then_reapply!
    migration.down
    UserQuest.reset_column_information
    migration.up
    UserQuest.reset_column_information
  end

  it "applies to a table that already holds rows without raising" do
    seed_user_quest!

    expect { rollback_then_reapply! }.not_to raise_error
  end

  it "backfills existing rows instead of leaving them NULL under a NOT NULL constraint" do
    user_quest = seed_user_quest!(state: "completed", progress: 3)

    rollback_then_reapply!

    row = connection.select_one("SELECT created_at, updated_at, state, progress FROM user_quests WHERE id = #{user_quest.id}")
    expect(row["created_at"]).to be_present
    expect(row["updated_at"]).to be_present
    # バックフィルは既存の業務データを書き換えない
    expect(row["state"]).to eq("completed")
    expect(row["progress"]).to eq(3)
  end

  it "leaves both columns NOT NULL and free of a non-constant default" do
    seed_user_quest!

    rollback_then_reapply!

    columns = connection.columns(:user_quests).index_by(&:name)
    %w[created_at updated_at].each do |name|
      expect(columns.fetch(name).null).to be(false), "#{name} should be NOT NULL"
      # CURRENT_TIMESTAMP を既定値として残すと、次に同じ手順を取ったときに再発する。
      expect(columns.fetch(name).default_function).to be_nil, "#{name} must not carry a non-constant default"
    end
  end

  it "keeps the NOT NULL constraint enforceable after the migration" do
    seed_user_quest!
    rollback_then_reapply!

    thread = Thread.new do
      Thread.current.report_on_exception = false
      ActiveRecord::Base.connection_pool.with_connection do |conn|
        begin
          conn.execute(
            "INSERT INTO user_quests (user_id, quest_id, state, progress, created_at, updated_at) " \
            "VALUES (999999, 999999, 'not_started', 0, NULL, NULL)"
          )
        ensure
          conn.reset!
        end
      end
    end

    expect { thread.value }.to raise_error(ActiveRecord::StatementInvalid)
  end
end
