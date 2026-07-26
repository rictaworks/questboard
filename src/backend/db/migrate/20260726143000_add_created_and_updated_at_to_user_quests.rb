class AddCreatedAndUpdatedAtToUserQuests < ActiveRecord::Migration[8.0]
  # 既存行があるテーブルに NOT NULL のタイムスタンプ列を追加するため、
  # nullable で追加 → 既存行を定数でバックフィル → NOT NULL 化 の順で行う。
  def up
    add_column :user_quests, :created_at, :datetime
    add_column :user_quests, :updated_at, :datetime

    backfilled_at = connection.quote(Time.current)
    execute(<<~SQL.squish)
      UPDATE user_quests
      SET created_at = #{backfilled_at}, updated_at = #{backfilled_at}
      WHERE created_at IS NULL OR updated_at IS NULL
    SQL

    change_column_null :user_quests, :created_at, false
    change_column_null :user_quests, :updated_at, false
  end

  def down
    remove_column :user_quests, :updated_at
    remove_column :user_quests, :created_at
  end
end
