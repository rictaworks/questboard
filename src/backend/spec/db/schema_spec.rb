require "rails_helper"

# schema.rb はマイグレーション適用後のDBから再生成される前提のファイルであり、
# 両者がずれると db:migrate で作ったDBと db:schema:load で作ったDBの制約が食い違う。
# user_quests のタイムスタンプ列に CURRENT_TIMESTAMP 既定値が残っていると、
# 新規環境だけ「created_at / updated_at を省略した直接INSERT」が通ってしまう（PR #61 レビュー）。
#
# テストDBは schema.rb からロードされるが、同一プロセス内の他specがマイグレーションを
# 実行し直すとDDLが入れ替わり順序依存になるため、ここではファイルの内容を直接検証する。
RSpec.describe "db/schema.rb" do
  let(:schema_source) { Rails.root.join("db/schema.rb").read }

  def create_table_body(table_name)
    body = schema_source[/create_table "#{Regexp.escape(table_name)}".*?^  end$/m]
    raise "create_table \"#{table_name}\" が schema.rb に見つからない" if body.nil?

    body
  end

  def column_definition(table_name, column_name)
    line = create_table_body(table_name)[/^\s*t\.\w+ "#{Regexp.escape(column_name)}".*$/]
    raise "#{table_name}.#{column_name} が schema.rb に見つからない" if line.nil?

    line
  end

  describe "user_quests" do
    %w[created_at updated_at].each do |column_name|
      it "declares #{column_name} without a non-constant default" do
        definition = column_definition("user_quests", column_name)

        expect(definition).not_to include("CURRENT_TIMESTAMP"),
                                  "#{column_name} の既定値はマイグレーション側で設定していないため schema.rb にも残してはいけない: #{definition.strip}"
        expect(definition).not_to match(/default:/),
                                  "#{column_name} に既定値があると db:schema:load で作ったDBだけ制約が緩くなる: #{definition.strip}"
      end

      it "keeps #{column_name} NOT NULL" do
        expect(column_definition("user_quests", column_name)).to include("null: false")
      end
    end
  end
end
