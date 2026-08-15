require "spec_helper"
require_relative "../support/deprecated_status_symbol_scanner"

# スキャナ本体の検査。実ファイルではなく文字列を渡して、Ruby がシンボルとして解釈する
# 表記をすべて拾えること、逆に散文中の同じ語は拾わないことを確かめる。
#
# 検査に使う名前は実在の非推奨シンボルではなく架空の名前にしてある。実在の名前を書くと、
# コードベース全体を走査する spec/lib/deprecated_rack_status_symbols_spec.rb が
# このフィクスチャ自身を違反として拾ってしまうため。
RSpec.describe DeprecatedStatusSymbolScanner do
  subject(:scanner) { described_class.new([ "legacy_status_name" ]) }

  describe "#occurrences_in" do
    it "素のシンボル表記を拾う" do
      source = <<~RUBY
        render json: { error: "" }, status: :legacy_status_name
      RUBY

      expect(scanner.occurrences_in(source)).to eq([ 1 ])
    end

    it "クオートされたシンボル表記を拾う" do
      source = <<~RUBY
        render status: :"legacy_status_name"
        render status: :'legacy_status_name'
      RUBY

      expect(scanner.occurrences_in(source)).to eq([ 1, 2 ])
    end

    it "%i リテラルの中を拾う" do
      source = <<~RUBY
        RETRYABLE = %i[not_found legacy_status_name].freeze
        OTHERS = %I(legacy_status_name)
      RUBY

      expect(scanner.occurrences_in(source)).to eq([ 1, 2 ])
    end

    it "to_sym による組み立てを拾う" do
      source = <<~RUBY
        render status: "legacy_status_name".to_sym
      RUBY

      expect(scanner.occurrences_in(source)).to eq([ 1 ])
    end

    it "ハッシュキーとしての定義を拾う" do
      source = <<~RUBY
        STATUSES = { legacy_status_name: 422 }.freeze
      RUBY

      expect(scanner.occurrences_in(source)).to eq([ 1 ])
    end

    it "散文に現れる同じ語は拾わない" do
      source = <<~RUBY
        # legacy_status_name は Rack 3.1 で非推奨になった
        it "rejects blank bodies with a legacy_status_name response" do
      RUBY

      expect(scanner.occurrences_in(source)).to be_empty
    end

    it "名前の一部が一致するだけの語は拾わない" do
      source = <<~RUBY
        render status: :legacy_status_name_v2
        render status: :my_legacy_status_name
      RUBY

      expect(scanner.occurrences_in(source)).to be_empty
    end

    it "同じ行に複数あっても行番号は一度だけ返す" do
      source = <<~RUBY
        [:legacy_status_name, :legacy_status_name]
      RUBY

      expect(scanner.occurrences_in(source)).to eq([ 1 ])
    end
  end

  describe "#scan" do
    it "走査対象が空なら結果を返さず拒む" do
      expect { scanner.scan([]) }.to raise_error(ArgumentError, /走査対象/)
    end
  end

  describe ".new" do
    it "検査対象が空なら組み立てを拒む" do
      expect { described_class.new([]) }.to raise_error(ArgumentError, /検査対象/)
    end
  end
end
