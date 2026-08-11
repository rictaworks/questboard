require "ripper"

# ソース検査で使う Ripper のトークン走査。
#
# 走査そのものを spec ごとに書くと、片方だけ解析を直したときにもう片方が古いまま残る。
# 行単位の grep ではコメント中の文字列とリテラルを区別できないため、走査は必ず
# トークン列に対して行う（:on_comment と :on_tstring_content が分かれる）。
#
# 1つのソースを複数の観点で調べるため、字句解析は `scan` で一度だけ行い、結果を使い回す。
module RubyTokenScanner
  # Ripper.lex の要素は [[行, 桁], 種別, 文字列, 状態]。
  Token = Struct.new(:line, :type, :value)

  # render の引数に現れる、応答本文に載り得る値の分類。
  #   :literal            … その場に書いた文字列。補間の有無は問わない
  #   :exception_message  … 例外のメッセージ（e.message / e.to_s。補間の中を含む）
  RenderValue = Struct.new(:line, :kind, :value)

  # 位置関係を index で辿るため、意味を持たないトークンは落とす。コメントを残すと
  # errors.add(:foo, # 説明\n :bar) のように引数の途中にコメントを書いただけで
  # 索引がずれ、走査が静かに空振りする。
  IGNORED_TOKEN_TYPES = [ :on_sp, :on_nl, :on_ignored_nl, :on_comment ].freeze

  NESTING_OPEN = [ :on_lparen, :on_lbrace, :on_lbracket, :on_embexpr_beg ].freeze
  # :on_embexpr_end を落とすと "#{...}" を含む文字列で深さが戻らず、引数の走査が
  # 次の文まで伸びて、そこにある e.message を拾ってしまう。
  NESTING_CLOSE = [ :on_rparen, :on_rbrace, :on_rbracket, :on_embexpr_end ].freeze

  STRING_OPEN = [ :on_tstring_beg, :on_heredoc_beg ].freeze

  # 文言として数えない文字列を、直前の呼び出しの名前で見分ける。
  #   ログ（warn/error/info/debug/fatal） … 利用者には出ない
  #   raise                              … 応答に載るかどうかは受け側の判断なので、そちらで数える
  #   t                                  … I18n.t に渡すカタログのキーであって文言ではない
  IGNORED_CALL_NAMES = %w[warn error info debug fatal raise t].freeze
  # 呼び出しの名前を遡って探すときに読み飛ばすトークン。ここで止まると、
  # 「その文字列がどの呼び出しの引数か」ではなく構文の飾りを拾ってしまう。
  SKIPPED_WHEN_LOOKING_BACK = [
    :on_comma, :on_const, :on_op, :on_period, :on_label, :on_symbeg,
    :on_lparen, :on_lbracket, :on_lbrace, :on_embexpr_beg
  ].freeze
  # 例外オブジェクトから文言を取り出す呼び出し。
  EXCEPTION_MESSAGE_METHODS = [ "message", "to_s" ].freeze
  # 例外を受けている可能性のある受け手。メソッドチェーンの途中は含めない。
  RECEIVER_TYPES = [ :on_ident, :on_ivar ].freeze

  module_function

  def scan(source)
    Scanned.new(
      Ripper.lex(source).map { |(line, _column), type, value, _state| Token.new(line, type, value) },
      method_line_ranges(source)
    )
  end

  # メソッド名 => 本体が占める行の範囲。
  #
  # def から対応する end までをトークン列で数えるには、後置の if / while を区別するために
  # 字句の状態まで見る必要があり、間違えると範囲が静かにずれる。構文木なら定義そのものを
  # 取り出せるため、Ripper.sexp を使う。
  def method_line_ranges(source)
    tree = Ripper.sexp(source)
    raise ArgumentError, "構文解析できないソースを走査しようとしている" if tree.nil?

    collect_method_line_ranges(tree, {})
  end

  def collect_method_line_ranges(node, collected)
    return collected unless node.is_a?(Array)

    if node.first == :def && node[1].is_a?(Array) && node[1].first == :@ident
      lines = node_lines(node)
      collected[node[1][1]] = (lines.min..lines.max) unless lines.empty?
    end

    node.each { |child| collect_method_line_ranges(child, collected) }
    collected
  end

  # 構文木の葉（[:@ident, "名前", [行, 桁]] の形）から行番号を集める。
  def node_lines(node)
    return [] unless node.is_a?(Array)
    return [ node[2].first ] if node.first.to_s.start_with?("@") && node[2].is_a?(Array) && node[2].first.is_a?(Integer)

    node.flat_map { |child| node_lines(child) }
  end

  class Scanned
    # 文字列の終わりが見つからないまま列が尽きた場合に投げる。黙って進むと以降の
    # トークンを文字列の一部として扱い、検査が静かにずれる。
    class UnterminatedStringError < StandardError; end

    def initialize(tokens, method_line_ranges)
      @tokens = tokens
      @method_line_ranges = method_line_ranges
      # 走査のたびに残り配列を複製すると、ソース長に対して二乗の手間になる。
      @significant = tokens.reject { |token| IGNORED_TOKEN_TYPES.include?(token.type) }
    end

    # コメントを除いた文字列リテラルを [行, 中身] で返す。
    def string_literals
      @tokens.filter_map do |token|
        next unless token.type == :on_tstring_content

        [ token.line, token.value ]
      end
    end

    # 応答本文に載り得る値を返す。
    #
    # 応答のキー名（error: など）で絞ると、別のキーで返した文言や `render json: { error: }`
    # の省略記法が無検査のまま通る。逆に、キーで絞らずファイル全体の文字列を見ると、
    # プロパティ名やイベントコードまで文言として台帳に載り、無関係な変更で赤くなる。
    # 「応答に渡る式であること」を条件にすれば、どちらの取りこぼしも起きない。
    #
    # 応答は render に直接書くとは限らない。次の2つの間接も辿る。
    #   payload = { error: e.message } … render json: payload
    #   render json: { error: not_found_message }（同じファイルに def がある呼び出し）
    # ログや raise、カタログのキーは利用者に出る文言ではないため、直前の呼び出しの名前で除く。
    def render_values
      (values_in_render_arguments + values_in_rendered_hashes + values_in_called_helpers).sort_by(&:line)
    end

    # I18n.t に文字列で渡しているカタログのキーを返す。
    #
    # ja.yml 側から「書いたキーが引けるか」を見るだけでは、コードが引くキーの打ち間違いや
    # 書き忘れは分からない。欠けたキーは例外にならず "Translation missing: ja.…" という
    # 文字列になり、そのまま応答本文に載る。
    def i18n_keys
      keys = []
      index = 0

      while index < @significant.length
        unless STRING_OPEN.include?(@significant[index].type)
          index += 1
          next
        end

        finish = string_end_index(@significant, index)
        keys << literal_text(@significant[index..finish]) if preceding_call_name(@significant, index) == "t"
        index = finish + 1
      end

      keys
    end

    # `errors.add(:attribute, :message_key)` の第一・第二引数を [属性, メッセージ] で返す。
    # メッセージがシンボルでない場合（文字列や省略）は nil。
    #
    # 第一引数だけを見る。引数リストを越えてシンボルを探すと、`errors.add(attribute, :blank)`
    # のような動的な指定で第二引数を属性名と誤認する。
    # :base はレコード全体に対するエラーで属性ではないため除く。
    def errors_add_pairs
      @significant.each_with_index.filter_map do |token, index|
        next unless token.type == :on_ident && token.value == "errors"
        next unless @significant[index + 1]&.value == "." && @significant[index + 2]&.value == "add"

        # errors.add(:foo, :bar) と errors.add :foo, :bar の両方を受ける。
        cursor = @significant[index + 3]&.type == :on_lparen ? index + 4 : index + 3
        attribute = symbol_at(cursor)
        next if attribute.nil? || attribute == :base

        message = @significant[cursor + 2]&.type == :on_comma ? symbol_at(cursor + 3) : nil
        [ attribute, message ]
      end.uniq
    end

    private

    def values_in_render_arguments
      render_argument_spans.flat_map { |span| values_in(span) }
    end

    def render_argument_spans
      @significant.each_with_index.filter_map do |token, index|
        next unless token.type == :on_ident && token.value == "render"

        render_arguments_from(index + 1)
      end
    end

    def values_in_rendered_hashes
      rendered_identifiers.flat_map { |name| values_in_hash_assigned_to(name) }
    end

    # render の引数から呼んでいる、同じファイルで定義されたメソッドの本体を走査する。
    # ここを見ないと、文言をヘルパーメソッドに移すだけで台帳から消える。
    # 辿るのは1段だけ。ヘルパーがさらに別のヘルパーを呼ぶ形は台帳に現れない。
    def values_in_called_helpers
      rendered_identifiers.flat_map do |name|
        range = @method_line_ranges[name]
        next [] if range.nil?

        values_in(@significant.select { |token| range.cover?(token.line) })
      end
    end

    # render に値として渡している識別子。変数名（後続の代入を辿る）と、同じファイルで
    # 定義されたメソッド名（本体を辿る）の両方に使う。レシーバ（後ろがピリオド）は
    # それ自体が値ではないため除く。
    def rendered_identifiers
      render_argument_spans.flat_map do |span|
        span.each_with_index.filter_map do |token, index|
          next unless token.type == :on_ident
          next if span[index + 1]&.type == :on_period

          token.value
        end
      end.uniq
    end

    def values_in_hash_assigned_to(name)
      @significant.each_with_index.flat_map do |token, index|
        next [] unless token.type == :on_ident && token.value == name
        next [] unless @significant[index + 1]&.type == :on_op && @significant[index + 1].value == "="
        next [] unless @significant[index + 2]&.type == :on_lbrace

        values_in(nesting_span_from(index + 2))
      end
    end

    # 開き括弧の位置から、対応する閉じ括弧までのトークンを返す。
    def nesting_span_from(index)
      depth = 0

      @significant[index..].to_a.take_while do |token|
        if NESTING_OPEN.include?(token.type)
          depth += 1
          true
        elsif NESTING_CLOSE.include?(token.type)
          depth -= 1
          depth.positive?
        else
          true
        end
      end
    end

    # render の引数トークンを返す。
    #
    # 引数は `json: {...}, status: :x` のようにカンマで続くため、深さ 0 のカンマでは
    # 切れない。深さ 0 に戻ったところで行が変わったら文の終わりとみなす。
    # ヒアドキュメントは本体が宣言行より後のトークンとして現れるため、閉じるまでは
    # 行が変わっても続きとして扱う。
    def render_arguments_from(index)
      depth = 0
      heredocs = 0
      collected = []

      @significant[index..].to_a.each do |token|
        # 深さ 0 で行が変わったら文の終わり。ただし直前がカンマなら引数が続いている。
        # ここで切ると、status を先に書いて本体を次の行に置くだけで走査から外れる。
        break if depth.zero? && heredocs.zero? && collected.last &&
          token.line != collected.last.line && collected.last.type != :on_comma

        case token.type
        when *NESTING_OPEN
          depth += 1
        when *NESTING_CLOSE
          depth -= 1
          break if depth.negative?
        when :on_heredoc_beg
          heredocs += 1
        when :on_heredoc_end
          heredocs -= 1
        when :on_semicolon
          break if depth.zero?
        end

        collected << token
      end

      collected
    end

    def values_in(tokens)
      values = []
      index = 0

      while index < tokens.length
        token = tokens[index]

        if STRING_OPEN.include?(token.type)
          finish = string_end_index(tokens, index)
          values << render_value_for(tokens[index..finish]) unless ignored_argument?(tokens, index)
          index = finish + 1
        elsif exception_message_at?(tokens, index)
          values << RenderValue.new(token.line, :exception_message, "") unless ignored_argument?(tokens, index)
          # 受け手・ピリオド・メソッド名の3つを消費する。
          index += 3
        else
          index += 1
        end
      end

      values
    end

    def render_value_for(span)
      RenderValue.new(span.first.line, exception_message_in?(span) ? :exception_message : :literal, literal_text(span))
    end

    # ログ・raise・カタログのキーは利用者に出る文言ではない。ヘルパーメソッドの本体まで
    # 走査するようになったため、この区別が要る（helper の中の logger.warn を数えない）。
    def ignored_argument?(tokens, index)
      IGNORED_CALL_NAMES.include?(preceding_call_name(tokens, index))
    end

    def exception_message_in?(span)
      span.each_with_index.any? { |_token, index| exception_message_at?(span, index) }
    end

    # その文字列がどの呼び出しの引数として書かれているかを、直前に遡って調べる。
    # 構文の飾り（カンマ・開き括弧・ラベル・定数など）は読み飛ばす。
    def preceding_call_name(tokens, index)
      cursor = index - 1

      while cursor >= 0 && SKIPPED_WHEN_LOOKING_BACK.include?(tokens[cursor].type)
        cursor -= 1
      end

      return nil if cursor.negative?
      return tokens[cursor].value if [ :on_ident, :on_kw ].include?(tokens[cursor].type)

      nil
    end

    # 文字列の開始位置から、対応する終わりの位置を返す。補間の中に別の文字列があるため、
    # 最初に見つかった終わりで打ち切ることはできない。
    def string_end_index(tokens, index)
      closing = tokens[index].type == :on_heredoc_beg ? :on_heredoc_end : :on_tstring_end
      interpolation = 0

      ((index + 1)...tokens.length).each do |cursor|
        case tokens[cursor].type
        when :on_embexpr_beg
          interpolation += 1
        when :on_embexpr_end
          interpolation -= 1
        when closing
          return cursor if interpolation.zero?
        end
      end

      raise UnterminatedStringError, "#{tokens[index].line} 行目から始まる文字列の終わりが見つからない"
    end

    # e.message / e.to_s の並びであるか。
    #
    # 値式のどこかに .to_s があるかだけを見ると、I18n.t("...", value: params[:x].to_s) のような
    # 正当な呼び出しまで例外の露出として数えてしまう。件数の枠が偽陽性で埋まると、
    # 本物の露出をその枠が覆い隠す。受け手が裸の識別子である場合に限る。
    def exception_message_at?(tokens, index)
      return false unless RECEIVER_TYPES.include?(tokens[index].type)
      # チェーンの途中（foo.bar.message）は受け手が例外そのものとは限らない。
      return false if index.positive? && tokens[index - 1].type == :on_period
      return false unless tokens[index + 1]&.type == :on_period

      method_name = tokens[index + 2]
      method_name&.type == :on_ident && EXCEPTION_MESSAGE_METHODS.include?(method_name.value)
    end

    # 補間の中身は文言ではないため、深さ 0 の中身だけを連結する。
    def literal_text(span)
      interpolation = 0

      span.filter_map do |token|
        case token.type
        when :on_embexpr_beg
          interpolation += 1
          nil
        when :on_embexpr_end
          interpolation -= 1
          nil
        when :on_tstring_content
          token.value if interpolation.zero?
        end
      end.join
    end

    def symbol_at(index)
      return nil unless @significant[index]&.type == :on_symbeg

      name = @significant[index + 1]
      return nil unless name && [ :on_ident, :on_const ].include?(name.type)

      name.value.to_sym
    end
  end
end
