class CreateQuestboardSchema < ActiveRecord::Migration[8.0]
  def change
    create_table :users, id: :bigint do |t|
      t.string :google_sub, null: false
      t.string :display_name, null: false
      t.datetime :created_at, null: false
    end

    add_index :users, :google_sub, unique: true

    create_table :roles, id: :integer do |t|
      t.string :code, null: false
    end

    add_index :roles, :code, unique: true

    create_table :boards, id: :bigint do |t|
      t.string :title, null: false
      t.string :share_token, null: false
      t.datetime :created_at, null: false
    end

    add_index :boards, :share_token, unique: true

    create_table :board_members, id: :bigint do |t|
      t.bigint :board_id, null: false
      t.bigint :user_id, null: false
      t.integer :role_id, null: false
    end

    add_index :board_members, %i[board_id user_id], unique: true
    add_index :board_members, :role_id
    add_foreign_key :board_members, :boards
    add_foreign_key :board_members, :users
    add_foreign_key :board_members, :roles, column: :role_id

    create_table :object_types, id: :integer do |t|
      t.string :code, null: false
    end

    add_index :object_types, :code, unique: true

    create_table :color_palettes, id: :integer do |t|
      t.string :hex, null: false
    end

    add_index :color_palettes, :hex, unique: true

    create_table :radial_menu_items, id: :integer do |t|
      t.string :code, null: false
      t.string :label, null: false
      t.integer :sort_order, null: false
    end

    add_index :radial_menu_items, :code, unique: true
    add_index :radial_menu_items, :sort_order, unique: true

    create_table :objects, id: :bigint do |t|
      t.bigint :board_id, null: false
      t.integer :object_type_id, null: false
      t.integer :color_id, null: false
      t.jsonb :geometry, null: false, default: {}
      t.jsonb :text_crdt, null: false, default: {}
      t.bigint :parent_frame_id
      t.datetime :deleted_at
    end

    add_index :objects, :board_id
    add_index :objects, :object_type_id
    add_index :objects, :color_id
    add_index :objects, :parent_frame_id
    add_index :objects, :deleted_at
    add_foreign_key :objects, :boards
    add_foreign_key :objects, :object_types, column: :object_type_id
    add_foreign_key :objects, :color_palettes, column: :color_id
    add_foreign_key :objects, :objects, column: :parent_frame_id

    create_table :object_ops, id: :bigint do |t|
      t.bigint :board_id, null: false
      t.bigint :object_id, null: false
      t.bigint :user_id, null: false
      t.string :property, null: false
      t.jsonb :value, null: false, default: {}
      t.bigint :lamport_ts, null: false
      t.string :client_id, null: false
    end

    add_index :object_ops, :board_id
    add_index :object_ops, :object_id
    add_index :object_ops, :user_id
    add_index :object_ops, %i[object_id client_id lamport_ts], unique: true
    add_foreign_key :object_ops, :boards
    add_foreign_key :object_ops, :objects
    add_foreign_key :object_ops, :users

    create_table :frame_locks, id: :bigint do |t|
      t.bigint :object_id, null: false
      t.bigint :locked_by, null: false
      t.datetime :locked_at, null: false
    end

    add_index :frame_locks, :object_id, unique: true
    add_index :frame_locks, :locked_by
    add_foreign_key :frame_locks, :objects
    add_foreign_key :frame_locks, :users, column: :locked_by

    create_table :comments, id: :bigint do |t|
      t.bigint :object_id, null: false
      t.bigint :user_id, null: false
      t.text :body, null: false
      t.datetime :created_at, null: false
    end

    add_index :comments, :object_id
    add_index :comments, :user_id
    add_foreign_key :comments, :objects
    add_foreign_key :comments, :users

    create_table :quests, id: :integer do |t|
      t.string :title, null: false
      t.string :condition_event, null: false
      t.integer :condition_count, null: false
    end

    add_index :quests, :title, unique: true

    create_table :user_quests, id: :bigint do |t|
      t.bigint :user_id, null: false
      t.integer :quest_id, null: false
      t.string :state, null: false, default: "not_started"
      t.integer :progress, null: false, default: 0
    end

    add_index :user_quests, %i[user_id quest_id], unique: true
    add_foreign_key :user_quests, :users
    add_foreign_key :user_quests, :quests, column: :quest_id

    create_table :effect_masters, id: :integer do |t|
      t.string :code, null: false
      t.integer :duration_ms, null: false
    end

    add_index :effect_masters, :code, unique: true

    create_table :event_defs, id: :integer do |t|
      t.string :code, null: false
      t.integer :effect_id, null: false
    end

    add_index :event_defs, :code, unique: true
    add_index :event_defs, :effect_id
    add_foreign_key :event_defs, :effect_masters, column: :effect_id

    create_table :kpi_events, id: :bigint do |t|
      t.integer :event_def_id, null: false
      t.bigint :user_id, null: false
      t.bigint :board_id, null: false
      t.jsonb :props, null: false, default: {}, comment: "PII禁止"
      t.datetime :occurred_at, null: false
    end

    add_index :kpi_events, :event_def_id
    add_index :kpi_events, :board_id
    add_index :kpi_events, :user_id
    add_index :kpi_events, :occurred_at
    add_foreign_key :kpi_events, :event_defs, column: :event_def_id
    add_foreign_key :kpi_events, :users
    add_foreign_key :kpi_events, :boards

    create_table :intensity_masters, id: :integer do |t|
      t.string :code, null: false
    end

    add_index :intensity_masters, :code, unique: true

    create_table :user_settings, primary_key: :user_id, id: :bigint do |t|
      t.integer :intensity_id, null: false
      t.boolean :sound_enabled, null: false, default: false
    end

    add_index :user_settings, :intensity_id
    add_foreign_key :user_settings, :users, column: :user_id
    add_foreign_key :user_settings, :intensity_masters, column: :intensity_id
  end
end
