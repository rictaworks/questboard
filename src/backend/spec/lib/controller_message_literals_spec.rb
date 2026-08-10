require "spec_helper"
require "ripper"
require_relative "../support/backend_source_tree"

# コントローラが返すユーザー向け文言は config/locales のカタログに置き、コントローラ側には
# 直書きしない。日本語をコントローラに直書きすると、カタログ側の文言を直したときに
# コントローラの文字列だけが古いまま残り、同じ入力ミスに対して経路によって違う日本語が
# 返る（例: コメント本文が空文字なら ja.yml 由来、キーごと欠落ならコントローラ直書き）。
#
# 文言が一致しているかどうかを個別の request spec で突き合わせても、両方が同じ文字列を
# ハードコードしていれば緑のまま通ってしまう。そのため「文言が合っているか」ではなく
# 「コントローラに日本語リテラルを書いていないこと」を直接検査する。
#
# 検査は正規表現ではなく Ripper のトークン列で行う。行単位の grep ではコメント中の日本語と
# 文字列リテラル中の日本語を区別できず、日本語コメント（設計意図の記録）まで禁止することに
# なってしまう。Ripper なら :on_comment と :on_tstring_content が分かれる。
#
# 対象は app/controllers に限る。app/views は表示テンプレート、app/services には別途
# 整理が必要な日本語リテラルが残っているため、それらは本検査の範囲外とする。
RSpec.describe "コントローラのユーザー向け文言" do
  # ここでの定数代入は Object の定数になりスイート全体へ漏れるため、メソッドで返す。
  #
  # 範囲を「ひらがな・カタカナ・漢字」だけにすると、長音符「ー」(U+30FC)・繰り返し符号
  # 「々」(U+3005)・波ダッシュ・全角括弧や読点だけで構成された文言を取りこぼす。
  # 拡張漢字（U+9FA6 以降、CJK 拡張 A）も同様に漏れるため、まとめて対象にする。
  def japanese_pattern
    /[\p{Hiragana}\p{Katakana}\p{Han}\p{-Uideo}ー々〆〜｜、。「」『』・！？]/
  end

  def controller_paths
    BackendSourceTree.ruby_paths("app/controllers")
  end

  # 文字列リテラルの中身だけを取り出す。:on_tstring_content は "..." / '...' / heredoc の
  # 本文に対応し、コメント（:on_comment）は含まれない。
  def japanese_string_literals(path)
    Ripper.lex(path.read).filter_map do |(line, _column), type, token, _state|
      next unless type == :on_tstring_content
      next unless token.match?(japanese_pattern)

      [ line, token ]
    end
  end

  it "コントローラに日本語の文字列リテラルを直書きしていない" do
    offenders = controller_paths.filter_map do |path|
      literals = japanese_string_literals(path)
      next if literals.empty?

      literals.map { |line, token| "  #{BackendSourceTree.relative(path)}:#{line} #{token.inspect}" }.join("\n")
    end

    expect(offenders).to be_empty, <<~MESSAGE
      コントローラに日本語の文字列リテラルが残っている。
      config/locales/ja.yml に文言を置き、I18n.t で参照すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  it "走査対象のコントローラを実際に読んでいる" do
    paths = controller_paths

    # 走査が空振りしていれば、違反ゼロという結果は「無かった」ではなく「見ていない」を意味する。
    expect(paths).not_to be_empty
    expect(paths.map { |path| BackendSourceTree.relative(path).to_s })
      .to include("app/controllers/comments_controller.rb")
  end

  it "日本語コメントは違反として扱わない" do
    # コメント中の日本語まで禁止すると設計意図を書けなくなる。Ripper でトークン種別を
    # 見分けている以上ここは通るはずだが、正規表現ベースの実装に書き換えられたときに
    # 気付けるよう検査として残す。
    tokens = Ripper.lex(<<~RUBY)
      # 日本語のコメント
      value = "ascii only"
    RUBY

    japanese_tokens = tokens.select { |_position, _type, token, _state| token.match?(japanese_pattern) }

    expect(japanese_tokens.map { |_position, type, _token, _state| type }).to eq([ :on_comment ])
  end

  it "長音符・繰り返し符号・全角記号だけの文言も検出する" do
    # 「エラー」「時々」「（注）」のように、漢字・かなの範囲指定だけでは漏れる文字がある。
    %w[ー 々 「 」 、 。 ・ ！ ？ 〜].each do |character|
      expect(character).to match(japanese_pattern), "#{character.inspect} が検出範囲から漏れている"
    end
  end
end
