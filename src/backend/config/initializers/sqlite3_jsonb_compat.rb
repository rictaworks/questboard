require "active_record/connection_adapters/sqlite3_adapter"

ActiveSupport.on_load(:active_record) do
  if defined?(ActiveRecord::ConnectionAdapters::SQLite3::TableDefinition)
    ActiveRecord::ConnectionAdapters::SQLite3::TableDefinition.class_eval do
      unless method_defined?(:jsonb)
        def jsonb(name, **options)
          json(name, **options)
        end
      end
    end
  end

  if defined?(ActiveRecord::ConnectionAdapters::SQLite3::SchemaDumper)
    ActiveRecord::ConnectionAdapters::SQLite3::SchemaDumper.prepend(
      Module.new do
        JSONB_TARGETS = {
          "objects" => %w[geometry text_crdt],
          "object_ops" => %w[value],
          "kpi_events" => %w[props]
        }.freeze

        COLUMN_COMMENTS = {
          "kpi_events" => {
            "props" => "PII禁止"
          }
        }.freeze

        def schema_type(column)
          tbl = table_name.to_s
          target_cols = JSONB_TARGETS[tbl]

          if (target_cols && target_cols.include?(column.name.to_s)) || column.sql_type.to_s.downcase == "jsonb"
            :jsonb
          else
            super
          end
        end

        def prepare_column_options(column)
          spec = super
          tbl = table_name.to_s
          if (comments_for_tbl = COLUMN_COMMENTS[tbl]) && (comment = comments_for_tbl[column.name.to_s]) && !spec.key?(:comment)
            spec[:comment] = comment.inspect
          end
          spec
        end
      end
    )
  end

end
