require "rails_helper"

RSpec.describe "Questboard database schema and seeds" do
  def connection
    ActiveRecord::Base.connection
  end

  def table_count(table_name)
    quoted_table = connection.quote_table_name(table_name)
    connection.select_value("SELECT COUNT(*) FROM #{quoted_table}").to_i
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

    object_columns = connection.columns("objects").map(&:name)
    expect(object_columns).to include("geometry", "text_crdt", "parent_frame_id", "deleted_at")

    object_ops_columns = connection.columns("object_ops").map(&:name)
    expect(object_ops_columns).to include("board_id", "object_id", "property", "value", "lamport_ts", "client_id")

    kpi_event_props = connection.columns("kpi_events").find { |column| column.name == "props" }
    if connection.adapter_name == "PostgreSQL"
      expect(kpi_event_props.comment).to eq("PII禁止")
    else
      expect(Rails.root.join("db/schema.rb").read).to include('comment: "PII禁止"')
    end

    expect(connection.primary_key("user_settings")).to eq("user_id")

    board_member_indexes = connection.indexes("board_members")
    expect(board_member_indexes.any? { |index| index.unique && index.columns == %w[board_id user_id] }).to be(true)

    frame_lock_indexes = connection.indexes("frame_locks")
    expect(frame_lock_indexes.any? { |index| index.unique && index.columns == %w[object_id] }).to be(true)
  end

  it "seeds the 72 master rows idempotently" do
    expect { Rails.application.load_seed }.to change { seed_table_total }.from(0).to(72)
    expect { Rails.application.load_seed }.not_to change { seed_table_total }

    expect(table_count("roles")).to eq(4)
    expect(table_count("object_types")).to eq(6)
    expect(table_count("radial_menu_items")).to eq(14)
    expect(table_count("effect_masters")).to eq(12)
    expect(table_count("intensity_masters")).to eq(3)
    expect(table_count("quests")).to eq(8)
    expect(table_count("event_defs")).to eq(15)
    expect(table_count("color_palettes")).to eq(10)
  end
end
