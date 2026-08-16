class DefineUserDeleteFkPolicies < ActiveRecord::Migration[8.0]
  def up
    change_column_null :kpi_events, :user_id, true
    change_column_null :object_ops, :user_id, true

    # ユーザー所有の運用データは、退会時にまとめて削除してよい。
    remove_foreign_key :board_members, :users
    add_foreign_key :board_members, :users, on_delete: :cascade

    remove_foreign_key :comments, :users
    add_foreign_key :comments, :users, on_delete: :cascade

    remove_foreign_key :frame_locks, :users, column: :locked_by
    add_foreign_key :frame_locks, :users, column: :locked_by, on_delete: :cascade

    remove_foreign_key :user_quests, :users
    add_foreign_key :user_quests, :users, on_delete: :cascade

    remove_foreign_key :user_settings, :users, column: :user_id
    add_foreign_key :user_settings, :users, column: :user_id, on_delete: :cascade

    # 分析・操作ログは残し、user_id だけを退会時に匿名化する。
    remove_foreign_key :kpi_events, :users
    add_foreign_key :kpi_events, :users, on_delete: :nullify

    remove_foreign_key :object_ops, :users
    add_foreign_key :object_ops, :users, on_delete: :nullify
  end

  def down
    change_column_null :object_ops, :user_id, false
    change_column_null :kpi_events, :user_id, false

    remove_foreign_key :board_members, :users
    add_foreign_key :board_members, :users

    remove_foreign_key :comments, :users
    add_foreign_key :comments, :users

    remove_foreign_key :frame_locks, :users, column: :locked_by
    add_foreign_key :frame_locks, :users, column: :locked_by

    remove_foreign_key :user_quests, :users
    add_foreign_key :user_quests, :users

    remove_foreign_key :user_settings, :users, column: :user_id
    add_foreign_key :user_settings, :users, column: :user_id

    remove_foreign_key :kpi_events, :users
    add_foreign_key :kpi_events, :users

    remove_foreign_key :object_ops, :users
    add_foreign_key :object_ops, :users
  end
end
