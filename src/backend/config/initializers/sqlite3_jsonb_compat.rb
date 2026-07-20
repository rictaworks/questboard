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
end
