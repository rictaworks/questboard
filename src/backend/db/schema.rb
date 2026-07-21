# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_07_20_230735) do
  create_table "board_members", force: :cascade do |t|
    t.bigint "board_id", null: false
    t.bigint "user_id", null: false
    t.integer "role_id", null: false
    t.index ["board_id", "user_id"], name: "index_board_members_on_board_id_and_user_id", unique: true
  end

  create_table "boards", force: :cascade do |t|
    t.string "title", null: false
    t.string "share_token", null: false
    t.datetime "created_at", null: false
    t.index ["share_token"], name: "index_boards_on_share_token", unique: true
  end

  create_table "color_palettes", force: :cascade do |t|
    t.string "hex", null: false
    t.index ["hex"], name: "index_color_palettes_on_hex", unique: true
  end

  create_table "comments", force: :cascade do |t|
    t.bigint "object_id", null: false
    t.bigint "user_id", null: false
    t.text "body", null: false
    t.index ["object_id"], name: "index_comments_on_object_id"
  end

  create_table "effect_masters", force: :cascade do |t|
    t.string "code", null: false
    t.integer "duration_ms", null: false
    t.index ["code"], name: "index_effect_masters_on_code", unique: true
  end

  create_table "event_defs", force: :cascade do |t|
    t.string "code", null: false
    t.integer "effect_id", null: false
    t.index ["code"], name: "index_event_defs_on_code", unique: true
  end

  create_table "frame_locks", force: :cascade do |t|
    t.bigint "object_id", null: false
    t.bigint "locked_by", null: false
    t.datetime "locked_at", null: false
    t.index ["object_id"], name: "index_frame_locks_on_object_id", unique: true
  end

  create_table "intensity_masters", force: :cascade do |t|
    t.string "code", null: false
    t.index ["code"], name: "index_intensity_masters_on_code", unique: true
  end

  create_table "kpi_events", force: :cascade do |t|
    t.integer "event_def_id", null: false
    t.bigint "user_id", null: false
    t.bigint "board_id", null: false
    t.jsonb "props", default: {}, null: false, comment: "PII禁止"
    t.datetime "occurred_at", null: false
    t.index ["board_id"], name: "index_kpi_events_on_board_id"
    t.index ["event_def_id"], name: "index_kpi_events_on_event_def_id"
    t.index ["occurred_at"], name: "index_kpi_events_on_occurred_at"
  end

  create_table "object_ops", force: :cascade do |t|
    t.bigint "board_id", null: false
    t.bigint "object_id", null: false
    t.bigint "user_id", null: false
    t.string "property", null: false
    t.jsonb "value", default: {}, null: false
    t.bigint "lamport_ts", null: false
    t.string "client_id", null: false
    t.index ["board_id"], name: "index_object_ops_on_board_id"
    t.index ["object_id"], name: "index_object_ops_on_object_id"
    t.index ["user_id"], name: "index_object_ops_on_user_id"
  end

  create_table "object_types", force: :cascade do |t|
    t.string "code", null: false
    t.index ["code"], name: "index_object_types_on_code", unique: true
  end

  create_table "objects", force: :cascade do |t|
    t.bigint "board_id", null: false
    t.integer "object_type_id", null: false
    t.integer "color_id", null: false
    t.jsonb "geometry", default: {}, null: false
    t.jsonb "text_crdt", default: {}, null: false
    t.bigint "parent_frame_id"
    t.datetime "deleted_at"
    t.index ["board_id"], name: "index_objects_on_board_id"
    t.index ["color_id"], name: "index_objects_on_color_id"
    t.index ["deleted_at"], name: "index_objects_on_deleted_at"
    t.index ["object_type_id"], name: "index_objects_on_object_type_id"
    t.index ["parent_frame_id"], name: "index_objects_on_parent_frame_id"
  end

  create_table "quests", force: :cascade do |t|
    t.string "title", null: false
    t.string "condition_event", null: false
    t.integer "condition_count", null: false
    t.index ["title"], name: "index_quests_on_title", unique: true
  end

  create_table "radial_menu_items", force: :cascade do |t|
    t.string "code", null: false
    t.string "label", null: false
    t.integer "sort_order", null: false
    t.index ["code"], name: "index_radial_menu_items_on_code", unique: true
    t.index ["sort_order"], name: "index_radial_menu_items_on_sort_order", unique: true
  end

  create_table "roles", force: :cascade do |t|
    t.string "code", null: false
    t.index ["code"], name: "index_roles_on_code", unique: true
  end

  create_table "user_quests", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.integer "quest_id", null: false
    t.string "state", default: "not_started", null: false
    t.integer "progress", default: 0, null: false
    t.index ["user_id", "quest_id"], name: "index_user_quests_on_user_id_and_quest_id", unique: true
  end

  create_table "user_settings", primary_key: "user_id", force: :cascade do |t|
    t.integer "intensity_id", null: false
    t.boolean "sound_enabled", default: false, null: false
  end

  create_table "users", force: :cascade do |t|
    t.string "google_sub", null: false
    t.string "display_name", null: false
    t.datetime "created_at", null: false
    t.index ["google_sub"], name: "index_users_on_google_sub", unique: true
  end

  add_foreign_key "board_members", "boards"
  add_foreign_key "board_members", "roles"
  add_foreign_key "board_members", "users"
  add_foreign_key "comments", "objects"
  add_foreign_key "comments", "users"
  add_foreign_key "event_defs", "effect_masters", column: "effect_id"
  add_foreign_key "frame_locks", "objects"
  add_foreign_key "frame_locks", "users", column: "locked_by"
  add_foreign_key "kpi_events", "boards"
  add_foreign_key "kpi_events", "event_defs"
  add_foreign_key "kpi_events", "users"
  add_foreign_key "object_ops", "boards"
  add_foreign_key "object_ops", "objects"
  add_foreign_key "object_ops", "users"
  add_foreign_key "objects", "boards"
  add_foreign_key "objects", "color_palettes", column: "color_id"
  add_foreign_key "objects", "object_types"
  add_foreign_key "objects", "objects", column: "parent_frame_id"
  add_foreign_key "user_quests", "quests"
  add_foreign_key "user_quests", "users"
  add_foreign_key "user_settings", "intensity_masters", column: "intensity_id"
  add_foreign_key "user_settings", "users"
end
