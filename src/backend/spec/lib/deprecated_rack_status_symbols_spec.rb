require "spec_helper"
require "rack"
require_relative "../support/backend_source_tree"
require_relative "../support/deprecated_status_symbol_scanner"

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
# 直接検査する。表記のゆれをどこまで拾うかは DeprecatedStatusSymbolScanner 側の責務で、
# spec/lib/deprecated_status_symbol_scanner_spec.rb が単体で検査している。
RSpec.describe "Rack の非推奨 HTTP ステータスシンボル" do
  # ここでの定数代入は Object の定数になりスイート全体へ漏れるため、メソッドで返す。
  def scanned_directories
    %w[app lib config db bin spec]
  end

  def ruby_source_paths
    BackendSourceTree.ruby_paths(*scanned_directories)
  end

  # 禁止シンボルは Rack 本体から取り出す。ここにハードコードすると、Rack 側で非推奨が
  # 追加されたときに検査が追随せず、気付かないまま同じ問題を作り込むことになる。
  # private_constant のため const_get で読む。読めない場合は Rack の内部構造が変わった
  # ということなので、握りつぶさず失敗させる。
  #
  # 参照は example の中だけで行う。example group のボディで raise すると RSpec は spec
  # ファイルのロードに失敗し、このファイルだけでなくスイート全体が 1 例も実行されなくなる。
  def rack_private_constant(name)
    Rack::Utils.const_get(name, false)
  rescue NameError => e
    raise "Rack::Utils から #{name} を読めない（Rack の内部構造が変わった可能性がある）: #{e.message}"
  end

  def replacement_guidance(symbol)
    replacement = rack_private_constant(:OBSOLETE_SYMBOL_MAPPINGS)[symbol]
    replacement ? ":#{replacement} に置き換えること" : "Rack が推奨する名称に置き換えること"
  end

  it "非推奨シンボルがバックエンドのソースに残っていない" do
    obsolete_symbols = rack_private_constant(:OBSOLETE_SYMBOLS_TO_STATUS_CODES).keys
    expect(obsolete_symbols).not_to be_empty

    obsolete_symbols.each do |symbol|
      scanner = DeprecatedStatusSymbolScanner.new([ symbol ])
      offenders = scanner.scan(ruby_source_paths)

      formatted = offenders.map do |path, lines|
        "#{BackendSourceTree.relative(path)}:#{lines.join(',')}"
      end

      expect(offenders).to be_empty, <<~MESSAGE
        非推奨の :#{symbol} が #{offenders.size} ファイルに残っている。#{replacement_guidance(symbol)}。

        #{formatted.join("\n")}
      MESSAGE
    end
  end

  it "走査対象のディレクトリを実際に読んでいる" do
    paths = ruby_source_paths

    # 走査が空振りしていれば、違反ゼロという結果は「無かった」ではなく「見ていない」を意味する。
    expect(paths).not_to be_empty
    expect(paths.map { |path| BackendSourceTree.relative(path).to_s })
      .to include(a_string_starting_with("app/controllers/"))
  end
end
