module Sqlite3JsonbCompat
  module_function

  JSONB_TARGETS = [
    ["kpi_events", "props"].freeze,
    ["object_ops", "value"].freeze,
    ["objects", "geometry"].freeze,
    ["objects", "text_crdt"].freeze
  ].freeze

  JSON_TARGETS = [].freeze

  def target_type(table_name, column_name)
    pair = [table_name.to_s, column_name.to_s]

    return :jsonb if JSONB_TARGETS.include?(pair)
    return :json if JSON_TARGETS.include?(pair)
  end

  def sqlite_schema_type(connection, table_name, column_name)
    return target_type(table_name, column_name).to_s if sqlite?(connection)

    column = connection.columns(table_name).find { |candidate| candidate.name == column_name.to_s }
    column&.sql_type
  end

  def jsonb_target?(table_name, column_name)
    target_type(table_name, column_name) == :jsonb
  end

  def json_target?(table_name, column_name)
    target_type(table_name, column_name) == :json
  end

  def sqlite?(connection)
    connection.adapter_name == "SQLite"
  end
end
