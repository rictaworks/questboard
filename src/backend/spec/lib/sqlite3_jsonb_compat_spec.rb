require "rails_helper"

RSpec.describe Sqlite3JsonbCompat do
  it "keeps real json columns separate from jsonb targets on SQLite" do
    sqlite_record_class = Class.new(ActiveRecord::Base) do
      self.abstract_class = true
    end
    stub_const("Sqlite3JsonbCompatSpecRecord", sqlite_record_class)

    sqlite_record_class.establish_connection(adapter: "sqlite3", database: ":memory:")
    sqlite_record_class.connection.create_table(:json_compat_examples) do |t|
      t.json :payload
      t.json :compat_payload
    end

    stub_const("Sqlite3JsonbCompat::JSON_TARGETS", [ [ "json_compat_examples", "payload" ] ].freeze)
    stub_const("Sqlite3JsonbCompat::JSONB_TARGETS", [ [ "json_compat_examples", "compat_payload" ] ].freeze)

    payload_column = sqlite_record_class.connection.columns(:json_compat_examples).find do |candidate|
      candidate.name == "payload"
    end
    compat_column = sqlite_record_class.connection.columns(:json_compat_examples).find do |candidate|
      candidate.name == "compat_payload"
    end

    expect(payload_column.sql_type).to eq("json")
    expect(compat_column.sql_type).to eq("json")
    expect(described_class.target_type("json_compat_examples", "payload")).to eq(:json)
    expect(described_class.target_type("json_compat_examples", "compat_payload")).to eq(:jsonb)
    expect(described_class.sqlite_schema_type(sqlite_record_class.connection, "json_compat_examples", "payload")).to eq("json")
    expect(described_class.sqlite_schema_type(sqlite_record_class.connection, "json_compat_examples", "compat_payload")).to eq("jsonb")
    expect(described_class.json_target?("json_compat_examples", "payload")).to be(true)
    expect(described_class.jsonb_target?("json_compat_examples", "compat_payload")).to be(true)
  ensure
    sqlite_record_class&.connection_pool&.disconnect!
  end
end
