require "pathname"

# 非推奨のステータスシンボルが Ruby ソースに書かれていないかを調べる。
#
# 拾いたいのは Ruby がシンボルとして解釈する表記であって、コメントやテスト名の散文に
# 現れる同じ語ではない。素のシンボルだけを見ていると、クオート付き・%i リテラル・
# to_sym・ハッシュキーといった書き方が検査をすり抜け、「テストが緑なのに非推奨シンボルが
# 生きている」状態を作ってしまうため、表記ごとにパターンを持つ。
class DeprecatedStatusSymbolScanner
  # `:name` — 直前が語構成文字や `:` でないこと（`::name` や `a:name` を除く）
  BARE_SYMBOL = ->(name) { /(?<![\w:]):#{name}\b/ }
  # `:"name"` / `:'name'`
  QUOTED_SYMBOL = ->(name) { /:(?<quote>["'])#{name}\k<quote>/ }
  # `%i[a name b]` / `%I(name)` — 区切り文字は [ ( { < の 4 種
  PERCENT_LITERAL = ->(name) { /%[iI][\[({<][^\])}>]*\b#{name}\b/ }
  # `"name".to_sym`
  TO_SYM = ->(name) { /(?<quote>["'])#{name}\k<quote>\s*\.\s*to_sym/ }
  # `name:` — ハッシュキーとしての定義。`Foo::name:` と `name::` は除く
  HASH_KEY = ->(name) { /(?<![\w:.])#{name}:(?!:)/ }

  PATTERN_BUILDERS = [ BARE_SYMBOL, QUOTED_SYMBOL, PERCENT_LITERAL, TO_SYM, HASH_KEY ].freeze

  def initialize(symbol_names)
    raise ArgumentError, "検査対象のシンボルが空のままスキャナを組み立てようとした" if symbol_names.empty?

    @patterns = symbol_names.flat_map do |symbol_name|
      escaped = Regexp.escape(symbol_name.to_s)
      PATTERN_BUILDERS.map { |build| build.call(escaped) }
    end
  end

  # ソース文字列のうち、非推奨シンボルが現れる行番号を昇順で返す。
  def occurrences_in(source)
    source.each_line.with_index(1).filter_map do |line, number|
      number if @patterns.any? { |pattern| line.match?(pattern) }
    end
  end

  # 与えられたパスを走査し、{ Pathname => [行番号] } を返す。
  # 走査対象が 1 件も無いまま「違反なし」を返すと検査が空転するため、そこは呼び出し側ではなく
  # ここで拒む。
  def scan(paths)
    paths = paths.to_a
    raise ArgumentError, "走査対象のファイルが 1 件も無い" if paths.empty?

    paths.each_with_object({}) do |path, offenders|
      lines = occurrences_in(Pathname.new(path).read)
      offenders[path] = lines unless lines.empty?
    end
  end
end
