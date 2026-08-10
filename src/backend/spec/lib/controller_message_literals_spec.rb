require "spec_helper"
require_relative "../support/backend_source_tree"
require_relative "../support/japanese_text"
require_relative "../support/ruby_token_scanner"

# コントローラが返すユーザー向け文言は config/locales のカタログに置き、コントローラ側には
# 直書きしない（CLAUDE.md「文字列リテラルは設定ファイル（またはDB）に分離すること」）。
#
# 個別の request spec で文言を突き合わせても、コントローラと spec の両方が同じ文字列を
# ハードコードしていれば緑のまま通る。そのため「文言が合っているか」ではなく
# 「文言をコントローラに書いていないこと」を直接検査する。
#
# 応答に文言が載る経路は2つある。
#   1. render json: { error: "文字列" }         … 直接書いた文言
#   2. render json: { error: e.message }        … raise 側に書いた文言が応答に出る
# 2 を見ないと、raise の文言を英語で書き足しても検査が緑のままになる。かといって
# raise 側の文字列を数えると、ログ用の内部メッセージ（利用者に出ない）まで巻き込む。
# 内部用か利用者向けかを分けられるのは受け側なので、経路 2 そのものを違反として扱う。
RSpec.describe "コントローラのユーザー向け文言" do
  # #125 で ja.yml へ移すまで残る既知の違反。**件数**で持つ。
  #
  # 文字列そのものを並べると、i18n と関係のない言い回しの修正でこの spec が赤くなり、
  # かつ #125 で1件消すたびにここも編集することになる。件数なら「増えていないこと」と
  # 「減ったのにリストが古いこと」の両方を、内容の二重管理なしに検出できる。
  def known_message_literals
    {
      "app/controllers/boards_controller.rb" => 7,
      "app/controllers/comments_controller.rb" => 5,
      "app/controllers/concerns/request_origin_guard.rb" => 2,
      "app/controllers/kpi_events_controller.rb" => 1,
      "app/controllers/objects_controller.rb" => 10,
      "app/controllers/quests_controller.rb" => 4
    }
  end

  def known_exception_message_renders
    {
      "app/controllers/auth/google_sessions_controller.rb" => 3,
      "app/controllers/boards_controller.rb" => 3,
      "app/controllers/kpi_events_controller.rb" => 2,
      "app/controllers/objects_controller.rb" => 6,
      "app/controllers/user_settings_controller.rb" => 2
    }
  end

  def controller_paths
    BackendSourceTree.ruby_paths("app/controllers")
  end

  def count_by_file
    controller_paths.each_with_object({}) do |path, collected|
      count = yield(path.read).size
      next if count.zero?

      collected[BackendSourceTree.relative(path).to_s] = count
    end
  end

  # 既知の件数と実測を突き合わせ、ずれを人間が読める形にする。
  def compare_with_known(actual, known, label)
    (actual.keys | known.keys).sort.filter_map do |file|
      counted = actual.fetch(file, 0)
      allowed = known.fetch(file, 0)
      next if counted == allowed

      if counted > allowed
        "  #{file}: #{label}が #{allowed} 件から #{counted} 件に増えている"
      else
        "  #{file}: #{label}が #{allowed} 件から #{counted} 件に減っている（リストを更新すること）"
      end
    end
  end

  it "応答に載せる文言をコントローラに直書きしていない" do
    actual = count_by_file { |source| RubyTokenScanner.string_literals_after_label(source, "error:") }
    differences = compare_with_known(actual, known_message_literals, "直書きの文言")

    expect(differences).to be_empty, <<~MESSAGE
      応答に載せる文言の直書き件数が既知の状態と食い違っている。
      新しく足したなら config/locales/ja.yml に置くこと。#125 で消したなら
      spec/lib/controller_message_literals_spec.rb の known_message_literals を更新すること。

      #{differences.join("\n")}
    MESSAGE
  end

  it "例外のメッセージをそのまま応答に載せていない" do
    actual = count_by_file { |source| RubyTokenScanner.exception_message_renders(source) }
    differences = compare_with_known(actual, known_exception_message_renders, "例外メッセージの露出")

    expect(differences).to be_empty, <<~MESSAGE
      例外メッセージを応答に載せている箇所の件数が既知の状態と食い違っている。
      e.message は raise 側に書いた英語（内部のパラメータ名を含むこともある）を
      そのまま利用者に見せる。ja.yml の文言に変換して返すこと。

      #{differences.join("\n")}
    MESSAGE
  end

  it "コントローラに日本語の文字列リテラルを直書きしていない" do
    # 応答本文以外（logger など）も含めて日本語を禁止する。日本語が出てくる時点で
    # 利用者に見せる文言である可能性が高く、カタログに置くべきものだから。
    offenders = controller_paths.filter_map do |path|
      literals = RubyTokenScanner.string_literals(path.read).filter_map do |line, value|
        next unless JapaneseText.japanese?(value)

        "  #{BackendSourceTree.relative(path)}:#{line} #{value.inspect}"
      end
      next if literals.empty?

      literals.join("\n")
    end

    expect(offenders).to be_empty, <<~MESSAGE
      コントローラに日本語の文字列リテラルが残っている。
      config/locales/ja.yml に文言を置き、I18n.t で参照すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  it "新しく直書きされた文言を検出できる" do
    # 検査そのものが動いていることを確かめる。既知の件数で緑になっている以上、
    # 検出ロジックが壊れても「違反ゼロ」と見分けがつかないため。
    source = <<~RUBY
      render json: { error: "Something went wrong" }, status: :not_found
    RUBY

    expect(RubyTokenScanner.string_literals_after_label(source, "error:"))
      .to eq([ [ 1, "Something went wrong" ] ])
  end

  it "例外メッセージの露出を検出できる" do
    source = <<~RUBY
      render json: { error: e.message }, status: :unprocessable_content
    RUBY

    expect(RubyTokenScanner.exception_message_renders(source)).to eq([ [ 1, "e" ] ])
  end

  it "文言以外の error: 指定は違反として扱わない" do
    # I18n.t やローカル変数を渡している箇所まで拾うと、正しく直したコードが赤くなる。
    source = <<~RUBY
      render json: { error: I18n.t("api.errors.example") }, status: :not_found
      render json: { error: message }, status: :not_found
      render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_content
    RUBY

    expect(RubyTokenScanner.string_literals_after_label(source, "error:")).to be_empty
    expect(RubyTokenScanner.exception_message_renders(source)).to be_empty
  end

  it "走査対象のコントローラを実際に読んでいる" do
    paths = controller_paths

    # 走査が空振りしていれば、違反ゼロという結果は「無かった」ではなく「見ていない」を意味する。
    expect(paths).not_to be_empty
    expect(paths.map { |path| BackendSourceTree.relative(path).to_s })
      .to include("app/controllers/comments_controller.rb")
  end

  it "日本語コメントは違反として扱わない" do
    # コメント中の日本語まで禁止すると設計意図を書けなくなる。トークン種別を見分けている
    # 以上ここは通るはずだが、正規表現ベースの実装に書き換えられたときに気付けるよう残す。
    source = <<~RUBY
      # 日本語のコメント
      value = "ascii only"
    RUBY

    expect(RubyTokenScanner.string_literals(source).map(&:last)).to eq([ "ascii only" ])
  end
end
