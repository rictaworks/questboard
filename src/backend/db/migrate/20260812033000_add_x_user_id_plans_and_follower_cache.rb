class AddXUserIdPlansAndFollowerCache < ActiveRecord::Migration[8.0]
  def up
    # 1. x_user_id を一時的に NULL 許容で追加
    add_column :users, :x_user_id, :string, comment: "XユーザーID"

    # 2. 既存ユーザーがいる場合は google_sub の値をコピーしてプレースホルダーにする
    # (既存ユーザーの移行は行わないため、単に NOT NULL 制約エラーを回避するための値コピー)
    execute "UPDATE users SET x_user_id = google_sub"

    # 3. x_user_id カラムを null: false に変更し、ユニークインデックスを追加
    change_column_null :users, :x_user_id, false
    add_index :users, :x_user_id, unique: true

    # 4. google_sub を削除
    remove_index :users, :google_sub
    remove_column :users, :google_sub, :string

    # 5. カラムコメントの変更
    change_column_comment :users, :display_name, from: nil, to: "X表示名"

    # 6. plans テーブルの作成
    create_table :plans, id: :bigint do |t|
      t.string :code, null: false
    end
    add_index :plans, :code, unique: true

    # 7. users に plan_id を追加し、外部キーを設定
    add_column :users, :plan_id, :bigint
    add_index :users, :plan_id
    add_foreign_key :users, :plans

    # 8. follower_cache テーブルの作成
    create_table :follower_cache, primary_key: :x_user_id, id: :string, comment: "Xフォロワー判定キャッシュ" do |t|
      t.datetime :fetched_at, null: false
    end
  end

  def down
    # 1. follower_cache の削除
    drop_table :follower_cache

    # 2. users から plan_id の外部キーとカラムを削除
    remove_foreign_key :users, :plans
    remove_index :users, :plan_id
    remove_column :users, :plan_id, :bigint

    # 3. plans テーブルの削除
    drop_table :plans

    # 4. display_name のコメントを元に戻す
    change_column_comment :users, :display_name, from: "X表示名", to: nil

    # 5. google_sub を NULL 許容で追加
    add_column :users, :google_sub, :string, comment: "Google Sub"

    # 6. x_user_id の値を google_sub に戻す
    execute "UPDATE users SET google_sub = x_user_id"

    # 7. google_sub を null: false に変更し、ユニークインデックスを追加
    change_column_null :users, :google_sub, false
    add_index :users, :google_sub, unique: true

    # 8. x_user_id を削除
    remove_index :users, :x_user_id
    remove_column :users, :x_user_id, :string
  end
end

