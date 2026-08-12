class AddXUserIdPlansAndFollowerCache < ActiveRecord::Migration[8.0]
  def change
    remove_index :users, :google_sub
    remove_column :users, :google_sub
    add_column :users, :x_user_id, :string, null: false, comment: "XユーザーID"
    add_index :users, :x_user_id, unique: true
    change_column_comment :users, :display_name, "X表示名"

    create_table :plans, id: :bigint do |t|
      t.string :code, null: false
    end

    add_index :plans, :code, unique: true

    add_column :users, :plan_id, :bigint
    add_index :users, :plan_id
    add_foreign_key :users, :plans

    # フォロワーには未登録ユーザーが含まれるため、users への外部キーは張らない。
    create_table :follower_cache, primary_key: :x_user_id, id: :string, comment: "Xフォロワー判定キャッシュ" do |t|
      t.datetime :fetched_at, null: false
    end
  end
end
