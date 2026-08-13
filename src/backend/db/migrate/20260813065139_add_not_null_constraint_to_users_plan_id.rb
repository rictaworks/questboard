class AddNotNullConstraintToUsersPlanId < ActiveRecord::Migration[8.1]
  def up
    # 既存の "none" プランを確保
    execute <<-SQL
      INSERT INTO plans (code)
      VALUES ('none')
      ON CONFLICT (code) DO NOTHING;
    SQL

    # plan_id が NULL のユーザーに "none" プランを割り当てる
    execute <<-SQL
      UPDATE users
      SET plan_id = (SELECT id FROM plans WHERE code = 'none' LIMIT 1)
      WHERE plan_id IS NULL;
    SQL

    # null: false 制約を設定
    change_column_null :users, :plan_id, false
  end

  def down
    change_column_null :users, :plan_id, true
  end
end
