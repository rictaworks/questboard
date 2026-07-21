# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).

def seed_table(table_name, rows, unique_by:)
  model = Class.new(ApplicationRecord) do
    self.table_name = table_name
  end

  model.upsert_all(rows, unique_by: unique_by)
  model
end

seed_table(
  "roles",
  [
    { code: "owner" },
    { code: "editor" },
    { code: "commenter" },
    { code: "viewer" }
  ],
  unique_by: :index_roles_on_code
)

seed_table(
  "object_types",
  [
    { code: "sticky" },
    { code: "shape" },
    { code: "text" },
    { code: "connector" },
    { code: "image" },
    { code: "frame" }
  ],
  unique_by: :index_object_types_on_code
)

seed_table(
  "radial_menu_items",
  [
    { code: "create_sticky", label: "付箋を作成", sort_order: 1 },
    { code: "create_shape", label: "図形を作成", sort_order: 2 },
    { code: "create_text", label: "テキストを作成", sort_order: 3 },
    { code: "create_frame", label: "フレームを作成", sort_order: 4 },
    { code: "duplicate", label: "複製", sort_order: 5 },
    { code: "delete", label: "削除", sort_order: 6 },
    { code: "lock", label: "ロック", sort_order: 7 },
    { code: "unlock", label: "ロック解除", sort_order: 8 },
    { code: "comment", label: "コメント", sort_order: 9 },
    { code: "align", label: "整列", sort_order: 10 },
    { code: "group", label: "グループ化", sort_order: 11 },
    { code: "ungroup", label: "グループ解除", sort_order: 12 },
    { code: "recolor", label: "色を変更", sort_order: 13 },
    { code: "share", label: "共有", sort_order: 14 }
  ],
  unique_by: :index_radial_menu_items_on_code
)

effect_model = seed_table(
  "effect_masters",
  [
    { code: "creation_pop", duration_ms: 180 },
    { code: "frame_materialize", duration_ms: 220 },
    { code: "deletion_dissolve", duration_ms: 240 },
    { code: "duplicate_burst", duration_ms: 160 },
    { code: "recolor_pulse", duration_ms: 140 },
    { code: "lock_shimmer", duration_ms: 260 },
    { code: "unlock_shimmer", duration_ms: 260 },
    { code: "comment_ping", duration_ms: 200 },
    { code: "share_pulse", duration_ms: 220 },
    { code: "radial_bloom", duration_ms: 180 },
    { code: "camera_swish", duration_ms: 300 },
    { code: "zoom_wave", duration_ms: 240 }
  ],
  unique_by: :index_effect_masters_on_code
)

seed_table(
  "intensity_masters",
  [
    { code: "full" },
    { code: "subtle" },
    { code: "off" }
  ],
  unique_by: :index_intensity_masters_on_code
)

seed_table(
  "color_palettes",
  [
    { hex: "#FDE68A" },
    { hex: "#FCA5A5" },
    { hex: "#FDBA74" },
    { hex: "#86EFAC" },
    { hex: "#93C5FD" },
    { hex: "#C4B5FD" },
    { hex: "#F9A8D4" },
    { hex: "#67E8F9" },
    { hex: "#D1D5DB" },
    { hex: "#1F2937" }
  ],
  unique_by: :index_color_palettes_on_hex
)

seed_table(
  "quests",
  [
    { title: "付箋を3枚作る", condition_event: "object_created_sticky", condition_count: 3 },
    { title: "ボードをパンする", condition_event: "camera_panned", condition_count: 1 },
    { title: "ズームする", condition_event: "camera_zoomed", condition_count: 1 },
    { title: "ラジアルメニューを開く", condition_event: "radial_opened", condition_count: 1 },
    { title: "オブジェクトを削除する", condition_event: "object_deleted", condition_count: 1 },
    { title: "フレームを作成する", condition_event: "object_created_frame", condition_count: 1 },
    { title: "ボードを共有する", condition_event: "board_shared", condition_count: 1 },
    { title: "コメントする", condition_event: "comment_created", condition_count: 1 }
  ],
  unique_by: :index_quests_on_title
)

effect_ids = effect_model.pluck(:code, :id).to_h

seed_table(
  "event_defs",
  [
    { code: "object_created_sticky", effect_id: effect_ids.fetch("creation_pop") },
    { code: "object_created_shape", effect_id: effect_ids.fetch("creation_pop") },
    { code: "object_created_text", effect_id: effect_ids.fetch("creation_pop") },
    { code: "object_created_image", effect_id: effect_ids.fetch("creation_pop") },
    { code: "object_created_frame", effect_id: effect_ids.fetch("frame_materialize") },
    { code: "object_deleted", effect_id: effect_ids.fetch("deletion_dissolve") },
    { code: "object_duplicated", effect_id: effect_ids.fetch("duplicate_burst") },
    { code: "object_recolored", effect_id: effect_ids.fetch("recolor_pulse") },
    { code: "object_locked", effect_id: effect_ids.fetch("lock_shimmer") },
    { code: "object_unlocked", effect_id: effect_ids.fetch("unlock_shimmer") },
    { code: "comment_created", effect_id: effect_ids.fetch("comment_ping") },
    { code: "board_shared", effect_id: effect_ids.fetch("share_pulse") },
    { code: "radial_opened", effect_id: effect_ids.fetch("radial_bloom") },
    { code: "camera_panned", effect_id: effect_ids.fetch("camera_swish") },
    { code: "camera_zoomed", effect_id: effect_ids.fetch("zoom_wave") }
  ],
  unique_by: :index_event_defs_on_code
)
