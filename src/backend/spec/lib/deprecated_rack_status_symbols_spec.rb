require "spec_helper"
require "rack"
require "pathname"

# Rack 3.1 以降、一部の HTTP ステータスシンボルは IANA の名称変更にあわせて非推奨になった
# （422 は Unprocessable Entity → Unprocessable Content）。
#
# 非推奨シンボルは今も従来どおりのステータスコードに解決されるため、テストの期待値を新名称に
# 変えるだけでは緑になってしまい、アプリ側に残った旧名称は検知できない。しかし Rack は
# 呼び出しのたびに「will be removed in a future version of Rack」と警告しており、実際に
# 削除されると `render status:` に渡した時点で ArgumentError になる。つまり
# バリデーションエラー応答（ユーザーが入力を間違えたときの全経路）が 500 に変わる。
#
# そのため「どのステータスコードを返すか」ではなく「旧名称のシンボルを書いていないこと」を
# 直接検査する。
RSpec.describe "Rack の非推奨 HTTP ステータスシンボル" do
  BACKEND_ROOT = Pathname.new(File.expand_path("../..", __dir__))
  SCANNED_DIRECTORIES = %w[app lib config spec].freeze

  # 禁止シンボルは Rack 本体から取り出す。ここにハードコードすると、Rack 側で非推奨が
  # 追加されたときに検査が追随せず、気付かないまま同じ問題を作り込むことになる。
  # private_constant のため const_get で読む。読めない場合は Rack 側の構造が変わった
  # ということなので、握りつぶさず失敗させる。
  def self.obsolete_status_symbols
    Rack::Utils.const_get(:OBSOLETE_SYMBOLS_TO_STATUS_CODES, false).keys
  rescue NameError => e
    raise "Rack::Utils から非推奨ステータスシンボルの一覧を取得できない（Rack の内部構造が変わった可能性がある）: #{e.message}"
  end

  def self.ruby_source_paths
    SCANNED_DIRECTORIES.flat_map do |directory|
      BACKEND_ROOT.join(directory).glob("**/*.rb")
    end
  end

  # コロンから始まるシンボル表記だけを拾う。テスト名などの散文に現れる
  # unprocessable_entity という語は対象外にする。
  def self.symbol_occurrence_pattern(symbol)
    /(?<![\w:]):#{Regexp.escape(symbol.to_s)}\b/
  end

  obsolete_status_symbols.each do |symbol|
    it "アプリコードに :#{symbol} が残っていない" do
      offenders = self.class.ruby_source_paths.filter_map do |path|
        matched_lines = path.each_line.with_index(1).filter_map do |line, number|
          number if line.match?(self.class.symbol_occurrence_pattern(symbol))
        end
        next if matched_lines.empty?

        "#{path.relative_path_from(BACKEND_ROOT)}:#{matched_lines.join(',')}"
      end

      replacement = Rack::Utils.const_get(:OBSOLETE_SYMBOL_MAPPINGS, false)[symbol]
      guidance = replacement ? ":#{replacement} に置き換えること" : "Rack が推奨する名称に置き換えること"

      expect(offenders).to be_empty, <<~MESSAGE
        非推奨の :#{symbol} が #{offenders.size} ファイルに残っている。#{guidance}。

        #{offenders.join("\n")}
      MESSAGE
    end
  end
end
