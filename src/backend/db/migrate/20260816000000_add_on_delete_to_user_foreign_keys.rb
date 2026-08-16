# ユーザー削除時の FK 挙動を明示する
#
# 方針:
#   board_members  → cascade  : メンバーシップはユーザーに従属。ユーザー削除で即除去。
#   comments       → cascade  : 投稿はユーザーに従属。ユーザー削除で即除去。
#   frame_locks    → cascade  : ロックはユーザーに従属。ユーザー削除でロック解除。
#   user_quests    → cascade  : 進捗はユーザーに従属。ユーザー削除で即除去。
#   user_settings  → cascade  : 設定はユーザーに従属。ユーザー削除で即除去。
#   kpi_events     → nullify  : 分析用イベントログは匿名化して保持。user_id を NULL 化。
#   object_ops     → nullify  : 操作ログは匿名化して保持。user_id を NULL 化。
class AddOnDeleteToUserForeignKeys < ActiveRecord::Migration[8.0]
  def up
    # kpi_events.user_id / object_ops.user_id を NULL 許可に変更（nullify に必要）
    change_column_null :kpi_events, :user_id, true
    change_column_null :object_ops, :user_id, true

    # 既存 FK を削除して on_delete オプション付きで再作成
    remove_foreign_key :board_members, :users
    remove_foreign_key :comments, :users
    remove_foreign_key :frame_locks, :users, column: :locked_by
    remove_foreign_key :kpi_events, :users
    remove_foreign_key :object_ops, :users
    remove_foreign_key :user_quests, :users
    remove_foreign_key :user_settings, :users

    add_foreign_key :board_members, :users, on_delete: :cascade
    add_foreign_key :comments,      :users, on_delete: :cascade
    add_foreign_key :frame_locks,   :users, column: :locked_by, on_delete: :cascade
    add_foreign_key :kpi_events,    :users, on_delete: :nullify
    add_foreign_key :object_ops,    :users, on_delete: :nullify
    add_foreign_key :user_quests,   :users, on_delete: :cascade
    add_foreign_key :user_settings, :users, on_delete: :cascade
  end

  def down
    # kpi_events / object_ops の NULL 化を元に戻す前に、NULL 行をバックフィル不可のため
    # down では NOT NULL 制約は復元しない（データ整合性を保つため）
    remove_foreign_key :board_members, :users
    remove_foreign_key :comments, :users
    remove_foreign_key :frame_locks, :users, column: :locked_by
    remove_foreign_key :kpi_events, :users
    remove_foreign_key :object_ops, :users
    remove_foreign_key :user_quests, :users
    remove_foreign_key :user_settings, :users

    add_foreign_key :board_members, :users
    add_foreign_key :comments,      :users
    add_foreign_key :frame_locks,   :users, column: :locked_by
    add_foreign_key :kpi_events,    :users
    add_foreign_key :object_ops,    :users
    add_foreign_key :user_quests,   :users
    add_foreign_key :user_settings, :users
  end
end
