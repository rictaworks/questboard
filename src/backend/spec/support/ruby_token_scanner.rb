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
  # 例外オブジェクトから文言を取り出す呼び出し。
  EXCEPTION_MESSAGE_METHODS = [ "message", "to_s" ].freeze
  # 例外を受けている可能性のある受け手。メソッドチェーンの途中は含めない。
  RECEIVER_TYPES = [ :on_ident, :on_ivar ].freeze

  module_function

  def scan(source)
    Scanned.new(
      Ripper.lex(source).map { |(line, _column), type, value, _state| Token.new(line, type, value) }
    )
  end

  class Scanned
    # 文字列の終わりが見つからないまま列が尽きた場合に投げる。黙って進むと以降の
    # トークンを文字列の一部として扱い、検査が静かにずれる。
    class UnterminatedStringError < StandardError; end

    def initialize(tokens)
      @tokens = tokens
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
    # ログや KPI のペイロードまで利用者向け文言として扱ってしまう。
    # 「応答に渡る式であること」を条件にすれば、どちらの取りこぼしも起きない。
    #
    # 応答は render に直接書くとは限らない。ハッシュを一度変数に組んでから渡す形
    # （payload = { error: e.message } … render json: payload）があるため、
    # render に渡した変数へ代入しているハッシュも同じ扱いにする。
    def render_values
      (values_in_render_arguments + values_in_rendered_hashes).sort_by(&:line)
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

    # render に値として渡している裸の識別子。メソッド呼び出し（後ろが括弧）と
    # レシーバ（後ろがピリオド）は変数ではないため除く。
    def rendered_identifiers
      render_argument_spans.flat_map do |span|
        span.each_with_index.filter_map do |token, index|
          next unless token.type == :on_ident

          following = span[index + 1]
          next if following && [ :on_lparen, :on_period ].include?(following.type)

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
        break if depth.zero? && heredocs.zero? && collected.last && token.line != collected.last.line

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
          span = tokens[index..finish]
          values << render_value_for(span) unless i18n_key?(tokens, index)
          index = finish + 1
        elsif exception_message_at?(tokens, index)
          values << RenderValue.new(token.line, :exception_message, "")
          # 受け手・ピリオド・メソッド名の3つを消費する。
          index += 3
        else
          index += 1
        end
      end

      values
    end

    def render_value_for(span)
      kind = span.each_with_index.any? { |_token, index| exception_message_at?(span, index) } ? :exception_message : :literal

      RenderValue.new(span.first.line, kind, literal_text(span))
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

    # I18n.t に渡すキーは利用者に見せる文言ではない。第一引数だけを除く。
    def i18n_key?(tokens, index)
      return false if index.zero?

      previous = tokens[index - 1]
      return true if previous.type == :on_ident && previous.value == "t"
      return false unless previous.type == :on_lparen && index >= 2

      tokens[index - 2].type == :on_ident && tokens[index - 2].value == "t"
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
