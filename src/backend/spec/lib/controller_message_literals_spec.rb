require "spec_helper"
require "ripper"
require_relative "../support/backend_source_tree"
require_relative "../support/japanese_text"

# コントローラが返すユーザー向け文言は config/locales のカタログに置き、コントローラ側には
# 直書きしない（CLAUDE.md「文字列リテラルは設定ファイル（またはDB）に分離すること」）。
#
# 個別の request spec で文言を突き合わせても、コントローラと spec の両方が同じ文字列を
# ハードコードしていれば緑のまま通る。そのため「文言が合っているか」ではなく
# 「文言をコントローラに書いていないこと」を直接検査する。
#
# 検査は正規表現ではなく Ripper のトークン列で行う。行単位の grep ではコメント中の文字列と
# リテラルを区別できず、日本語コメント（設計意図の記録）まで巻き込む。Ripper なら
# :on_comment と :on_tstring_content が分かれる。
RSpec.describe "コントローラのユーザー向け文言" do
  # 応答本文に載る文言。ここに文字列リテラルがあれば、それは利用者に見える文言を
  # コードに直書きしているということ。
  def user_facing_label
    "error:"
  end

  # #125 で ja.yml へ移すまで残る既知の違反。ここに載っているものは失敗させないが、
  # 「リストに無い違反が増えた」ことと「リストにあるのに直っている（＝陳腐化した）」ことの
  # 両方を検出する。件数を黙って見逃すと、検査が緑であることが「違反ゼロ」に見えてしまう。
  def known_offenders
    {
      "app/controllers/boards_controller.rb" => [
        "Board not found",
        "Unsupported invite role",
        "Cannot remove the last owner"
      ],
      "app/controllers/comments_controller.rb" => [
        "Board or object not found",
        "Comment could not be recorded"
      ],
      "app/controllers/concerns/request_origin_guard.rb" => [
        "Forbidden origin",
        "Content-Type must be application/json"
      ],
      "app/controllers/kpi_events_controller.rb" => [
        "Board not found"
      ],
      "app/controllers/objects_controller.rb" => [
        "Board or object type not found",
        "Board or object not found",
        "Object was locked by another user",
        "lamport_ts must be an integer"
      ],
      "app/controllers/quests_controller.rb" => [
        "Cannot skip quest",
        "Cannot reopen quest",
        "Cannot claim reward",
        "Board not found"
      ]
    }
  end

  def controller_paths
    BackendSourceTree.ruby_paths("app/controllers")
  end

  # `error:` ラベルの直後に置かれた文字列リテラルを拾う。ラベルと文字列の間には
  # 空白しか来ないため、空白を読み飛ばして次のトークンが文字列の開始かを見る。
  def user_facing_literals(source)
    tokens = Ripper.lex(source)

    tokens.each_with_index.filter_map do |((line, _column), type, token, _state), index|
      next unless type == :on_label && token == user_facing_label

      following = tokens[(index + 1)..].reject { |(_position, kind, _value, _state)| kind == :on_sp }
      next unless following.first && following.first[1] == :on_tstring_beg
      next unless following[1] && following[1][1] == :on_tstring_content

      [ line, following[1][2] ]
    end
  end

  def literals_by_file
    controller_paths.each_with_object({}) do |path, collected|
      literals = user_facing_literals(path.read)
      next if literals.empty?

      collected[BackendSourceTree.relative(path).to_s] = literals
    end
  end

  it "応答に載せる文言をコントローラに直書きしていない" do
    unexpected = literals_by_file.flat_map do |file, literals|
      allowed = known_offenders.fetch(file, [])
      literals.filter_map do |line, literal|
        next if allowed.include?(literal)

        "  #{file}:#{line} #{literal.inspect}"
      end
    end

    expect(unexpected).to be_empty, <<~MESSAGE
      応答に載せる文言がコントローラに直書きされている。
      config/locales/ja.yml に置き、I18n.t で参照すること。

      #{unexpected.join("\n")}
    MESSAGE
  end

  it "既知の違反リストが実態と合っている" do
    # 直したのにリストに残っていると、次に同じ場所へ直書きしても検査を素通りする。
    actual = literals_by_file.transform_values { |literals| literals.map(&:last).uniq }

    stale = known_offenders.flat_map do |file, literals|
      (literals - actual.fetch(file, [])).map { |literal| "  #{file} #{literal.inspect}" }
    end

    expect(stale).to be_empty, <<~MESSAGE
      既知の違反リストに、もう存在しない文言が残っている（#125 の進捗と食い違っている）。
      spec/lib/controller_message_literals_spec.rb の known_offenders から外すこと。

      #{stale.join("\n")}
    MESSAGE
  end

  it "コントローラに日本語の文字列リテラルを直書きしていない" do
    # 応答本文以外（logger など）も含めて日本語を禁止する。日本語が出てくる時点で
    # 利用者に見せる文言である可能性が高く、カタログに置くべきものだから。
    offenders = controller_paths.filter_map do |path|
      literals = Ripper.lex(path.read).filter_map do |(line, _column), type, token, _state|
        next unless type == :on_tstring_content
        next unless JapaneseText.japanese?(token)

        "  #{BackendSourceTree.relative(path)}:#{line} #{token.inspect}"
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
    # 検査そのものが動いていることを確かめる。既知の違反リストで緑になっている以上、
    # 検出ロジックが壊れても「違反ゼロ」と見分けがつかないため。
    source = <<~RUBY
      render json: { error: "Something went wrong" }, status: :not_found
    RUBY

    expect(user_facing_literals(source)).to eq([ [ 1, "Something went wrong" ] ])
  end

  it "文言以外の error: 指定は違反として扱わない" do
    # I18n.t やローカル変数を渡している箇所まで拾うと、正しく直したコードが赤くなる。
    source = <<~RUBY
      render json: { error: I18n.t("api.errors.example") }, status: :not_found
      render json: { error: message }, status: :not_found
    RUBY

    expect(user_facing_literals(source)).to be_empty
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

    japanese_tokens = tokens.select { |_position, _type, token, _state| JapaneseText.japanese?(token) }

    expect(japanese_tokens.map { |_position, type, _token, _state| type }).to eq([ :on_comment ])
  end
end
