# フォロワー判定をフォロワー判定サービス（x-follower-gate）へ委譲する（Issue #253）。
#
# 判定・救済・クールダウンをすべて委譲するため、questboard 側に残る器を落とす。
# **未使用の器を残さない。** 残すと、どちらが判定の根拠なのかが読み手に分からなくなる。
class DelegateFollowerGate < ActiveRecord::Migration[8.1]
  def up
    # 手動メンバー指定は判定サービスのオーバーライド（allow）へ一本化した。
    remove_column :users, :is_manual_member
    # 手動再判定のクールダウンは判定サービスが持つ。
    remove_column :users, :manual_rechecked_at
    # フォロワー集合は判定サービスのみが保持する。
    drop_table :follower_cache
  end

  def down
    add_column :users, :is_manual_member, :boolean, default: false, null: false
    add_column :users, :manual_rechecked_at, :datetime

    create_table :follower_cache, primary_key: :x_user_id, id: :string, comment: "Xフォロワー判定キャッシュ" do |t|
      t.datetime :fetched_at, null: false
    end
  end
end
