require "spec_helper"
require "digest"
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
  # #125 で ja.yml へ移すまで残る既知の違反。
  #
  # 文字列をそのまま並べると、i18n と関係のない言い回しの修正でこの spec が赤くなり、
  # #125 で1件消すたびにここも編集することになる。かといって件数だけで持つと、
  # 1件を ja.yml に移しつつ別の1件を足す差し引きゼロの変更を見逃す。
  # ソートした文言列のダイジェストで持てば、内容の二重管理を避けたまま
  # 増加・減少・入れ替えのいずれも検出できる。
  def known_message_literals
    {
      "app/controllers/boards_controller.rb" => "4976fe84ce39c87b",
      "app/controllers/comments_controller.rb" => "8073cb4c58833c1b",
      "app/controllers/concerns/request_origin_guard.rb" => "80681692ad70c711",
      "app/controllers/kpi_events_controller.rb" => "5189e31d848d693d",
      "app/controllers/objects_controller.rb" => "d19e2d8770634113",
      "app/controllers/quests_controller.rb" => "a32cafc04d37ebd0"
    }
  end

  # 例外メッセージの露出は文言そのものがコントローラに無いため、件数で持つ。
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

  # 1ファイルにつき字句解析は一度だけ行い、複数の観点で使い回す。
  def scanned_controllers
    @scanned_controllers ||= controller_paths.to_h do |path|
      [ BackendSourceTree.relative(path).to_s, RubyTokenScanner.scan(path.read) ]
    end
  end

  def error_values(kind)
    scanned_controllers.each_with_object({}) do |(file, scanned), collected|
      values = scanned.label_values("error:").select { |value| value.kind == kind }
      next if values.empty?

      collected[file] = values
    end
  end

  def digest_of(literals)
    Digest::SHA256.hexdigest(literals.sort.join("\n"))[0, 16]
  end

  it "応答に載せる文言をコントローラに直書きしていない" do
    actual = error_values(:literal).transform_values { |values| values.map(&:value) }
    known = known_message_literals

    differences = (actual.keys | known.keys).sort.filter_map do |file|
      literals = actual.fetch(file, [])
      current = literals.empty? ? nil : digest_of(literals)
      next if current == known[file]

      "  #{file}\n    既知: #{known.fetch(file, '(なし)')}\n    実際: #{current || '(なし)'}\n" \
        "    現在の文言: #{literals.sort.inspect}"
    end

    expect(differences).to be_empty, <<~MESSAGE
      直書きされた文言が既知の状態と食い違っている。
      新しく足したなら config/locales/ja.yml に置くこと。#125 で消したなら
      spec/lib/controller_message_literals_spec.rb の known_message_literals を
      「実際」の値へ更新すること。

      #{differences.join("\n")}
    MESSAGE
  end

  it "例外のメッセージをそのまま応答に載せていない" do
    actual = error_values(:exception_message).transform_values(&:size)
    known = known_exception_message_renders

    differences = (actual.keys | known.keys).sort.filter_map do |file|
      counted = actual.fetch(file, 0)
      allowed = known.fetch(file, 0)
      next if counted == allowed

      "  #{file}: #{allowed} 件から #{counted} 件になっている"
    end

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
    offenders = scanned_controllers.flat_map do |file, scanned|
      scanned.string_literals.filter_map do |line, value|
        next unless JapaneseText.japanese?(value)

        "  #{file}:#{line} #{value.inspect}"
      end
    end

    expect(offenders).to be_empty, <<~MESSAGE
      コントローラに日本語の文字列リテラルが残っている。
      config/locales/ja.yml に文言を置き、I18n.t で参照すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  describe "検査そのものの動作" do
    # 既知の状態で緑になる以上、検出が壊れても「違反ゼロ」と見分けがつかない。
    # 分類の境目を実物のソースで固定する。
    def classify(source)
      RubyTokenScanner.scan(source).label_values("error:").map { |value| [ value.kind, value.value ] }
    end

    it "直書きの文言を検出する" do
      expect(classify('render json: { error: "Something went wrong" }, status: :not_found'))
        .to eq([ [ :literal, "Something went wrong" ] ])
    end

    it "例外メッセージの露出を検出する" do
      expect(classify("render json: { error: e.message }, status: :x").map(&:first))
        .to eq([ :exception_message ])
    end

    it "文字列に埋め込んだ例外メッセージも露出として検出する" do
      # ここを取りこぼすと、e.message を "#{e.message}" に書き換えるだけで件数が減り、
      # 「違反が1件直った」ように見えてしまう。
      expect(classify('render json: { error: "#{e.message}" }, status: :x').map(&:first))
        .to eq([ :exception_message ])
    end

    it "to_s による露出も検出する" do
      expect(classify("render json: { error: e.to_s }, status: :x").map(&:first))
        .to eq([ :exception_message ])
    end

    it "カタログ参照や変数は違反として扱わない" do
      source = <<~RUBY
        render json: { error: I18n.t("api.errors.example") }, status: :x
        render json: { error: message }, status: :x
        render json: { error: e.record.errors.full_messages.to_sentence }, status: :x
      RUBY

      expect(classify(source).map(&:first)).to eq([ :other, :other, :other ])
    end

    it "文言の入れ替えをダイジェストが検出する" do
      # 件数だけで持つと、1件を ja.yml へ移しつつ別の1件を足す変更が素通りする。
      expect(digest_of([ "A", "B" ])).not_to eq(digest_of([ "A", "C" ]))
      expect(digest_of([ "A", "B" ])).to eq(digest_of([ "B", "A" ]))
    end

    it "日本語コメントは違反として扱わない" do
      source = <<~RUBY
        # 日本語のコメント
        value = "ascii only"
      RUBY

      expect(RubyTokenScanner.scan(source).string_literals.map(&:last)).to eq([ "ascii only" ])
    end
  end

  it "走査対象のコントローラを実際に読んでいる" do
    # 走査が空振りしていれば、違反ゼロという結果は「無かった」ではなく「見ていない」を意味する。
    expect(scanned_controllers.keys).to include("app/controllers/comments_controller.rb")
    expect(scanned_controllers.size).to be >= known_message_literals.size
  end
end
