require "rails_helper"

RSpec.describe "Questboard database schema and seeds" do
  def connection
    ActiveRecord::Base.connection
  end

  def table_count(table_name)
    quoted_table = connection.quote_table_name(table_name)
    connection.select_value("SELECT COUNT(*) FROM #{quoted_table}").to_i
  end

  def all_migrations_content
    Dir.glob(Rails.root.join("db/migrate/*.rb")).sort.map { |path| File.read(path) }.join("\n")
  end

  def seed_table_total
    %w[
      roles
      object_types
      radial_menu_items
      effect_masters
      intensity_masters
      quests
      event_defs
      color_palettes
    ].sum { |table_name| table_count(table_name) }
  end

  it "defines the required tables, columns, and constraints" do
    expect(connection.tables).to include(
      "users",
      "roles",
      "boards",
      "board_members",
      "object_types",
      "color_palettes",
      "radial_menu_items",
      "objects",
      "object_ops",
      "frame_locks",
      "comments",
      "quests",
      "user_quests",
      "event_defs",
      "kpi_events",
      "user_settings",
      "effect_masters",
      "intensity_masters"
    )

    user_columns = connection.columns("users").map(&:name)
    expect(user_columns).to include("google_sub", "display_name", "created_at")
    user_indexes = connection.indexes("users")
    expect(user_indexes.any? { |index| index.unique && index.columns == %w[google_sub] }).to be(true)

    object_columns = connection.columns("objects").map(&:name)
    expect(object_columns).to include("geometry", "text_crdt", "parent_frame_id", "deleted_at")

    object_ops_columns = connection.columns("object_ops").map(&:name)
    expect(object_ops_columns).to include("board_id", "object_id", "property", "value", "lamport_ts", "client_id")

    kpi_event_props = connection.columns("kpi_events").find { |column| column.name == "props" }
    expect(kpi_event_props.comment).to eq("PII禁止")

    expect(connection.primary_key("user_settings")).to eq("user_id")
    expect(connection.columns("objects").find { |c| c.name == "geometry" }.sql_type).to eq("jsonb")
    expect(connection.columns("objects").find { |c| c.name == "text_crdt" }.sql_type).to eq("jsonb")
    expect(connection.columns("object_ops").find { |c| c.name == "value" }.sql_type).to eq("jsonb")
    expect(connection.columns("kpi_events").find { |c| c.name == "props" }.sql_type).to eq("jsonb")

    # schema.rb は t.jsonb 呼び出しのまま維持すること。db:schema:load で復元した DB と
    # マイグレーション適用後の DB が同じ型定義になるよう、PostgreSQL の表記を直接守る。
    schema_content = Rails.root.join("db/schema.rb").read
    expect(schema_content).to match(/t\.jsonb "geometry"/)
    expect(schema_content).to match(/t\.jsonb "text_crdt"/)
    expect(schema_content).to match(/t\.jsonb "value"/)
    expect(schema_content).to match(/t\.jsonb "props"/)

    migration_content = all_migrations_content
    expect(migration_content).to include("t.jsonb :geometry")
    expect(migration_content).to include("t.jsonb :text_crdt")
    expect(migration_content).to include("t.jsonb :value")
    expect(migration_content).to include("t.jsonb :props")

    board_member_indexes = connection.indexes("board_members")
    expect(board_member_indexes.any? { |index| index.unique && index.columns == %w[board_id user_id] }).to be(true)
    expect(board_member_indexes.any? { |index| index.columns == %w[role_id] }).to be(true)

    frame_lock_indexes = connection.indexes("frame_locks")
    expect(frame_lock_indexes.any? { |index| index.unique && index.columns == %w[object_id] }).to be(true)
    expect(frame_lock_indexes.any? { |index| index.columns == %w[locked_by] }).to be(true)

    comment_indexes = connection.indexes("comments")
    expect(comment_indexes.any? { |index| index.columns == %w[user_id] }).to be(true)

    event_def_indexes = connection.indexes("event_defs")
    expect(event_def_indexes.any? { |index| index.columns == %w[effect_id] }).to be(true)

    kpi_event_indexes = connection.indexes("kpi_events")
    expect(kpi_event_indexes.any? { |index| index.columns == %w[user_id] }).to be(true)

    user_setting_indexes = connection.indexes("user_settings")
    expect(user_setting_indexes.any? { |index| index.columns == %w[intensity_id] }).to be(true)

    object_op_indexes = connection.indexes("object_ops")
    expect(object_op_indexes.any? { |index|
      index.unique && index.columns == %w[object_id client_id lamport_ts]
    }).to be(true)
  end

  it "seeds the 75 master rows idempotently" do
    conn = ActiveRecord::Base.connection
    %w[
      frame_locks object_ops comments objects user_quests kpi_events user_settings board_members boards users
      event_defs effect_masters roles object_types radial_menu_items intensity_masters quests color_palettes
    ].each do |table_name|
      conn.execute("DELETE FROM #{conn.quote_table_name(table_name)}")
    end

    expect { Rails.application.load_seed }.to change { seed_table_total }.from(0).to(75)
    expect { Rails.application.load_seed }.not_to change { seed_table_total }

    expect(table_count("roles")).to eq(4)
    expect(table_count("object_types")).to eq(6)
    expect(table_count("radial_menu_items")).to eq(15)
    expect(table_count("effect_masters")).to eq(12)
    expect(table_count("intensity_masters")).to eq(3)
    expect(table_count("quests")).to eq(8)
    expect(table_count("event_defs")).to eq(17)
    expect(table_count("color_palettes")).to eq(10)
  end
end
