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

  # `label: <値式>` の値式が何であるかの分類。
  #   :literal            … 補間のない文字列リテラル。文言をその場に書いている
  #   :exception_message  … 例外のメッセージを応答に載せている（"#{e.message}" や e.to_s を含む）
  #   :other              … I18n.t や変数など。検査対象外
  LabelValue = Struct.new(:line, :kind, :value)

  IGNORED_TOKEN_TYPES = [ :on_sp, :on_nl, :on_ignored_nl ].freeze

  # 値式の終わりとみなす区切り。深さ 0 で現れたところで値が終わる。
  VALUE_TERMINATORS = [ :on_comma, :on_rbrace, :on_rparen, :on_semicolon ].freeze
  NESTING_OPEN = [ :on_lparen, :on_lbrace, :on_lbracket, :on_embexpr_beg ].freeze
  NESTING_CLOSE = [ :on_rparen, :on_rbrace, :on_rbracket ].freeze

  module_function

  def scan(source)
    Scanned.new(
      Ripper.lex(source).map { |(line, _column), type, value, _state| Token.new(line, type, value) }
    )
  end

  class Scanned
    def initialize(tokens)
      @tokens = tokens
      # 位置関係を index で辿るため、空白を落とした列を一度だけ作る。
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

    # `label: <値式>` を見つけ、値式を分類して返す。
    #
    # 「文字列リテラルが直後にあるか」だけを見ると、`error: "#{e.message}"` や
    # `error: e.to_s` がどちらの検査にも掛からない。しかも件数は減るため、
    # 書き換えた側には「違反が1件直った」ように見えてしまう。値式全体を見て分類する。
    def label_values(label)
      @significant.each_with_index.filter_map do |token, index|
        next unless token.type == :on_label && token.value == label

        value_tokens = value_expression_from(index + 1)
        next if value_tokens.empty?

        LabelValue.new(token.line, classify(value_tokens), literal_text(value_tokens))
      end
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

    # index から値式の終わりまでのトークンを返す。入れ子の中の区切りでは終わらない。
    def value_expression_from(index)
      depth = 0

      @significant[index..].to_a.take_while do |token|
        if NESTING_OPEN.include?(token.type)
          depth += 1
          true
        elsif NESTING_CLOSE.include?(token.type)
          depth -= 1
          depth >= 0
        elsif VALUE_TERMINATORS.include?(token.type)
          depth.positive?
        else
          true
        end
      end
    end

    def classify(value_tokens)
      return :exception_message if exception_message?(value_tokens)
      return :literal if value_tokens.first&.type == :on_tstring_beg && value_tokens.none? { |token| token.type == :on_embexpr_beg }

      :other
    end

    # e.message / e.to_s / "#{e.message}" のいずれか。補間の中身も同じ列に現れる。
    def exception_message?(value_tokens)
      value_tokens.each_with_index.any? do |token, index|
        next false unless token.type == :on_period

        method_name = value_tokens[index + 1]
        method_name&.type == :on_ident && [ "message", "to_s" ].include?(method_name.value)
      end
    end

    def literal_text(value_tokens)
      value_tokens.select { |token| token.type == :on_tstring_content }.map(&:value).join
    end

    def symbol_at(index)
      return nil unless @significant[index]&.type == :on_symbeg

      name = @significant[index + 1]
      return nil unless name && [ :on_ident, :on_const ].include?(name.type)

      name.value.to_sym
    end
  end
end
