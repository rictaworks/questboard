require "active_record/connection_adapters/sqlite3_adapter"

module Sqlite3JsonbCompat
  # SQLite 上では jsonb と json、コメントの有無を区別できないため、
  # PostgreSQL 用の schema.rb を正しく復元するにはここに明示するしかない。
  # 新しく t.jsonb 列（またはコメント付き列）をマイグレーションに追加したら
  # 必ずこのハッシュも更新すること。更新漏れは
  # spec/models/schema_and_seed_spec.rb の
  # "keeps Sqlite3JsonbCompat definitions in sync with migrations" で検知される。
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

  module SchemaDumperPatch
    private

    def schema_type(column)
      tbl = table_name.to_s
      target_cols = Sqlite3JsonbCompat::JSONB_TARGETS[tbl]

      if (target_cols && target_cols.include?(column.name.to_s)) || column.sql_type.to_s.downcase == "jsonb"
        :jsonb
      else
        super
      end
    end

    def prepare_column_options(column)
      spec = super
      tbl = table_name.to_s
      comments_for_tbl = Sqlite3JsonbCompat::COLUMN_COMMENTS[tbl]
      comment = comments_for_tbl && comments_for_tbl[column.name.to_s]
      spec[:comment] = comment.inspect if comment && !spec.key?(:comment)
      spec
    end
  end
end

ActiveSupport.on_load(:active_record) do
  if defined?(ActiveRecord::ConnectionAdapters::SQLite3::TableDefinition)
    ActiveRecord::ConnectionAdapters::SQLite3::TableDefinition.class_eval do
      unless method_defined?(:jsonb)
        # SQLite に jsonb 型は無いため json として保存する。列の生SQL型を
        # そのまま "jsonb" にする案も検討したが、add_foreign_key 等で
        # SQLite アダプタがテーブルを再構築する際（ALTER TABLE 未対応の
        # ため create + copy + drop で作り直す）、列の生成は
        # column.type（json/jsonb を区別しないキャスト型シンボル）経由になり
        # "jsonb" という表記は必ず失われる。したがって型の復元は
        # schema.rb ダンプ時（Sqlite3JsonbCompat::SchemaDumperPatch）で行う。
        def jsonb(name, **options)
          json(name, **options)
        end
      end
    end
  end

  if defined?(ActiveRecord::ConnectionAdapters::SQLite3::SchemaDumper)
    ActiveRecord::ConnectionAdapters::SQLite3::SchemaDumper.prepend(Sqlite3JsonbCompat::SchemaDumperPatch)
  end
end
