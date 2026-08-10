require "ripper"

# ソース検査で使う Ripper のトークン走査。
#
# 走査そのものを spec ごとに書くと、片方だけ解析を直したときにもう片方が古いまま残る。
# 行単位の grep ではコメント中の文字列とリテラルを区別できないため、走査は必ず
# トークン列に対して行う（:on_comment と :on_tstring_content が分かれる）。
module RubyTokenScanner
  # Ripper.lex の要素は [[行, 桁], 種別, 文字列, 状態]。
  Token = Struct.new(:line, :type, :value)

  module_function

  def tokens(source)
    Ripper.lex(source).map { |(line, _column), type, value, _state| Token.new(line, type, value) }
  end

  # 空白と改行を落としたトークン列。位置関係を index で辿るために、毎回 reject せず
  # 一度だけ作る（呼び出しごとに残り配列を複製すると走査がソース長の二乗になる）。
  def significant_tokens(source)
    tokens(source).reject { |token| [ :on_sp, :on_nl, :on_ignored_nl ].include?(token.type) }
  end

  # `label: "文字列"` の形で書かれた文字列リテラルを [行, 中身] で返す。
  def string_literals_after_label(source, label)
    list = significant_tokens(source)

    list.each_with_index.filter_map do |token, index|
      next unless token.type == :on_label && token.value == label

      opening = list[index + 1]
      content = list[index + 2]
      next unless opening&.type == :on_tstring_beg && content&.type == :on_tstring_content

      [ content.line, content.value ]
    end
  end

  # `raise SomeError, "文字列"` の形で書かれた文字列リテラルを [行, 中身] で返す。
  #
  # raise で組み立てたメッセージは rescue 節で `error: e.message` として応答に載るため、
  # 直接 error: に書いた文字列と同じく利用者の目に触れる。
  # 引数が次の行に続くことは稀なので、raise と同じ行にあるものを対象にする。
  def string_literals_after_raise(source)
    list = significant_tokens(source)

    list.each_with_index.flat_map do |token, index|
      # raise はキーワードではなくメソッド呼び出しとして字句解析される（:on_ident）。
      next [] unless token.type == :on_ident && token.value == "raise"

      list[(index + 1)..]
        .take_while { |following| following.line == token.line }
        .select { |following| following.type == :on_tstring_content }
        .map { |following| [ following.line, following.value ] }
    end
  end

  # `error: e.message` のように、例外のメッセージをそのまま応答に載せている箇所を
  # [行, receiver] で返す。
  #
  # raise 側に書かれた文字列は Ripper だけでは「ログ用の内部メッセージ」と
  # 「利用者に見せる文言」を区別できない。区別できるのは受け側で、例外メッセージを
  # 応答に載せた瞬間にそれは利用者向けの文言になる。経路そのものを検査対象にする。
  def exception_message_renders(source)
    list = significant_tokens(source)

    list.each_with_index.filter_map do |token, index|
      next unless token.type == :on_label && token.value == "error:"

      receiver = list[index + 1]
      next unless receiver&.type == :on_ident
      next unless list[index + 2]&.value == "." && list[index + 3]&.value == "message"

      [ receiver.line, receiver.value ]
    end
  end

  # `errors.add(:attribute, …)` の第一引数を返す。
  #
  # 第一引数だけを見る。後続の引数までシンボルを探しに行くと、`errors.add(attribute, :blank)`
  # のような動的な指定で第二引数（:blank）を属性名と誤認する。
  # :base はレコード全体に対するエラーで属性ではないため除く。
  def errors_add_attributes(source)
    list = significant_tokens(source)

    list.each_with_index.filter_map do |token, index|
      next unless token.type == :on_ident && token.value == "errors"
      next unless list[index + 1]&.value == "." && list[index + 2]&.value == "add"

      # errors.add(:foo) と errors.add :foo の両方を受ける。
      first_argument = list[index + 3]&.type == :on_lparen ? index + 4 : index + 3
      next unless list[first_argument]&.type == :on_symbeg

      name = list[first_argument + 1]
      next unless name&.type == :on_ident
      next if name.value == "base"

      name.value.to_sym
    end.uniq
  end

  # コメントを除いた文字列リテラルのうち、条件に合うものを [行, 中身] で返す。
  def string_literals(source)
    tokens(source).filter_map do |token|
      next unless token.type == :on_tstring_content

      [ token.line, token.value ]
    end
  end
end
