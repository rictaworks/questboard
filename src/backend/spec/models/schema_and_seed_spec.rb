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

    object_columns = connection.columns("objects").map(&:name)
    expect(object_columns).to include("geometry", "text_crdt", "parent_frame_id", "deleted_at")

    object_ops_columns = connection.columns("object_ops").map(&:name)
    expect(object_ops_columns).to include("board_id", "object_id", "property", "value", "lamport_ts", "client_id")

    kpi_event_props = connection.columns("kpi_events").find { |column| column.name == "props" }
    if connection.adapter_name == "PostgreSQL"
      expect(kpi_event_props.comment).to eq("PII禁止")
    else
      expect(all_migrations_content).to include('comment: "PII禁止"')
    end

    expect(connection.primary_key("user_settings")).to eq("user_id")

    if connection.adapter_name == "PostgreSQL"
      expect(connection.columns("objects").find { |c| c.name == "geometry" }.sql_type).to eq("jsonb")
      expect(connection.columns("objects").find { |c| c.name == "text_crdt" }.sql_type).to eq("jsonb")
      expect(connection.columns("object_ops").find { |c| c.name == "value" }.sql_type).to eq("jsonb")
      expect(connection.columns("kpi_events").find { |c| c.name == "props" }.sql_type).to eq("jsonb")
    end

    # schema.rb は t.jsonb 呼び出しのまま維持すること。SQLite ではこの呼び出しを
    # sqlite3_jsonb_compat.rb が json 型として実体化するため、schema.rb 上の表記が
    # t.json になると db:schema:load を使う PostgreSQL 環境で jsonb が失われる。
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

  it "keeps Sqlite3JsonbCompat definitions in sync with actual database schema" do
    connection = ActiveRecord::Base.connection

    if connection.adapter_name == "PostgreSQL"
      actual_jsonb = Hash.new { |h, k| h[k] = [] }
      actual_comments = Hash.new { |h, k| h[k] = {} }

      connection.tables.each do |table|
        connection.columns(table).each do |column|
          actual_jsonb[table] << column.name if column.sql_type.to_s.downcase == "jsonb"
          actual_comments[table][column.name] = column.comment if column.comment.present?
        end
      end

      all_jsonb_tables = (actual_jsonb.keys + Sqlite3JsonbCompat::JSONB_TARGETS.keys).uniq
      all_jsonb_tables.each do |table|
        expect((Sqlite3JsonbCompat::JSONB_TARGETS[table] || []).sort).to eq((actual_jsonb[table] || []).sort)
      end

      all_comment_tables = (actual_comments.keys + Sqlite3JsonbCompat::COLUMN_COMMENTS.keys).uniq
      all_comment_tables.each do |table|
        expect(Sqlite3JsonbCompat::COLUMN_COMMENTS[table] || {}).to eq(actual_comments[table] || {})
      end
    else
      # SQLite環境: 実DBのカラムおよび型（json/jsonb）を基準に検証
      Sqlite3JsonbCompat::JSONB_TARGETS.each do |table, columns|
        expect(connection.table_exists?(table)).to be(true), "JSONB_TARGETS に登録されているテーブル #{table} が実際のDBに存在しません。"
        db_columns = connection.columns(table).index_by(&:name)
        columns.each do |column|
          col_obj = db_columns[column]
          expect(col_obj).not_to be_nil, "JSONB_TARGETS に登録されている #{table}.#{column} が実際のDBに存在しません。"
          expect(%i[json jsonb]).to include(col_obj.type), "JSONB_TARGETS の #{table}.#{column} は実際のDBでは json/jsonb 型ではありません (#{col_obj.type})"
        end
      end

      connection.tables.each do |table|
        db_json_columns = connection.columns(table).select { |c| %i[json jsonb].include?(c.type) }.map(&:name)
        expected_json_columns = Sqlite3JsonbCompat::JSONB_TARGETS[table] || []
        expect(expected_json_columns.sort).to eq(db_json_columns.sort),
          "実DBの #{table} テーブルに存在する json/jsonb 型カラム #{db_json_columns.inspect} が Sqlite3JsonbCompat::JSONB_TARGETS と不一致です。"
      end

      Sqlite3JsonbCompat::COLUMN_COMMENTS.each do |table, columns|
        expect(connection.table_exists?(table)).to be(true), "COLUMN_COMMENTS に登録されているテーブル #{table} が実際のDBに存在しません。"
        db_columns = connection.columns(table).index_by(&:name)
        columns.each_key do |column|
          expect(db_columns[column]).not_to be_nil, "COLUMN_COMMENTS に登録されている #{table}.#{column} が実際のDBに存在しません。"
        end
      end
    end
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
