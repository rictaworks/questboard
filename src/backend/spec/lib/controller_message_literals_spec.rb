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
#
# どちらも「応答に渡る式であること」で拾う。error: というキー名で絞ると、別のキーで
# 返した文言や `render json: { error: }` の省略記法が無検査のまま通るため。
RSpec.describe "コントローラのユーザー向け文言" do
  # 応答に直書きされている文字列の既知の状態。
  #
  # 大半は #125 で ja.yml へ移すまで残る違反だが、health_controller の "ok" や
  # objects_controller の "ref_revision"（応答のキー）のように、利用者に見せる文言では
  # ない機械可読な値も含まれる。この台帳の役目は「違反の一覧」ではなく
  # 「応答に直書きが増えたら気付く」ことなので、区別せずすべて載せる。
  #
  # 文字列をそのまま並べると、i18n と関係のない言い回しの修正でこの spec が赤くなり、
  # #125 で1件消すたびにここも編集することになる。かといって件数だけで持つと、
  # 1件を ja.yml に移しつつ別の1件を足す差し引きゼロの変更を見逃す。
  # ソートした文言列のダイジェストで持てば、内容の二重管理を避けたまま
  # 増加・減少・入れ替えのいずれも検出できる。
  def known_message_literals
    {
      "app/controllers/health_controller.rb" => "6437c52449b723e4",
      "app/controllers/objects_controller.rb" => "45ca6edf00af9a20",
      # 入力エラーで render :index するようになり（#187）、一覧取得に使う SQL 断片と
      # プランコードが応答経路のリテラルとして計上されるようになった。
      # 内訳は ["%%", "member", "none", "x_user_id = ? OR display_name LIKE ?"] で、
      # 利用者に見せる文言は含まれない
      "app/controllers/admin/users_controller.rb" => "0e085eae2a063cc7"
    }
  end

  # 例外メッセージの露出は文言そのものがコントローラに無いため、件数の代わりに
  # 「どのメソッドで露出しているか」の集合をダイジェストで持つ。
  #
  # 件数だけで持つと、あるメソッドの e.message 露出をやめて、同じファイルの別のメソッドに
  # 新しい露出を足す差し引きゼロの入れ替えを見逃す（known_message_literals をダイジェストに
  # した理由と同じ）。RubyTokenScanner は :exception_message の value に、その露出を
  # 囲むメソッド名を持たせているため、それをダイジェストの材料にする。
  #
  # ActionController::ParameterMissing は ApplicationController の rescue_from で
  # 受けるようになったため、ここに残っているのは各コントローラ固有の例外だけ。
  def known_exception_message_renders
    {
      "app/controllers/application_controller.rb" => "505cdf552d16d4d5"
    }
  end

  def controller_paths
    BackendSourceTree.ruby_paths("app/controllers")
  end

  def service_paths
    BackendSourceTree.ruby_paths("app/services")
  end

  # 1ファイルにつき字句解析は一度だけ行い、複数の観点で使い回す。
  def scanned_controllers
    @scanned_controllers ||= controller_paths.to_h do |path|
      [ BackendSourceTree.relative(path).to_s, RubyTokenScanner.scan(path.read) ]
    end
  end

  def scanned_services
    @scanned_services ||= service_paths.to_h do |path|
      [ BackendSourceTree.relative(path).to_s, RubyTokenScanner.scan(path.read) ]
    end
  end

  def response_values(kind)
    scanned_controllers.each_with_object({}) do |(file, scanned), collected|
      values = scanned.render_values.select { |value| value.kind == kind }
      next if values.empty?

      collected[file] = values
    end
  end

  def digest_of(literals)
    Digest::SHA256.hexdigest(literals.sort.join("\n"))[0, 16]
  end

  it "応答に載せる文言をコントローラに直書きしていない" do
    actual = response_values(:literal).transform_values { |values| values.map(&:value) }
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
    actual = response_values(:exception_message).transform_values { |values| values.map(&:value) }
    known = known_exception_message_renders

    differences = (actual.keys | known.keys).sort.filter_map do |file|
      identities = actual.fetch(file, [])
      current = identities.empty? ? nil : digest_of(identities)
      next if current == known[file]

      "  #{file}\n    既知: #{known.fetch(file, '(なし)')}\n    実際: #{current || '(なし)'}\n" \
        "    現在の露出元メソッド: #{identities.sort.inspect}"
    end

    expect(differences).to be_empty, <<~MESSAGE
      例外メッセージを応答に載せている箇所が既知の状態と食い違っている。
      e.message は raise 側に書いた英語（内部のパラメータ名を含むこともある）を
      そのまま利用者に見せる。ja.yml の文言に変換して返すこと。新しく足したのでなければ、
      spec/lib/controller_message_literals_spec.rb の known_exception_message_renders を
      「実際」の値へ更新すること。

      #{differences.join("\n")}
    MESSAGE
  end

  it "コントローラとサービスに日本語の文字列リテラルを直書きしていない" do
    # 応答本文以外（logger など）も含めて日本語を禁止する。日本語が出てくる時点で
    # 利用者に見せる文言である可能性が高く、カタログに置くべきものだから。
    offenders = (scanned_controllers.merge(scanned_services)).flat_map do |file, scanned|
      scanned.string_literals.filter_map do |line, value|
        next unless JapaneseText.japanese?(value)

        "  #{file}:#{line} #{value.inspect}"
      end
    end

    expect(offenders).to be_empty, <<~MESSAGE
      コントローラとサービスに日本語の文字列リテラルが残っている。
      config/locales/ja.yml に文言を置き、I18n.t で参照すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  describe "検査そのものの動作" do
    # 既知の状態で緑になる以上、検出が壊れても「違反ゼロ」と見分けがつかない。
    # 分類の境目を実物のソースで固定する。
    def classify(source)
      RubyTokenScanner.scan(source).render_values.map { |value| [ value.kind, value.value ] }
    end

    it "直書きの文言を検出する" do
      expect(classify('render json: { error: "Something went wrong" }, status: :not_found'))
        .to eq([ [ :literal, "Something went wrong" ] ])
    end

    it "補間を含む文言も直書きとして検出する" do
      # 補間があるだけで検査から外れると、内部のIDを含む英語の文言が素通りする。
      # 直書きの検査に載らないまま、利用者にはレコードIDごと見えることになる。
      expect(classify('render json: { error: "Board #{board.id} not found" }, status: :not_found'))
        .to eq([ [ :literal, "Board  not found" ] ])
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

    it "補間のある文言が次の文を飲み込まない" do
      # 補間の閉じで深さが戻らないと、値の走査が次の行まで伸びてそこの e.message を拾う。
      # 直書きが1件増えたのに、報告されるのは無関係な例外露出の件数になり、
      # 読む側は原因と関係のない行を追うことになる。
      source = <<~'RUBY'
        render json: { error: "Missing #{name}" }, status: :x
        render json: { error: e.message }, status: :x
      RUBY

      expect(classify(source)).to eq([ [ :literal, "Missing " ], [ :exception_message, "" ] ])
    end

    it "error 以外のキーで返す文言も検出する" do
      # キー名で絞ると、別のキーに載せ替えるだけで検査を外れてしまう。
      source = <<~RUBY
        render json: { message: "Board not found" }, status: :not_found
        render json: { errors: [ "Unsupported invite role" ] }, status: :x
      RUBY

      expect(classify(source)).to eq([ [ :literal, "Board not found" ], [ :literal, "Unsupported invite role" ] ])
    end

    it "変数に組んでから返すハッシュも検出する" do
      # 応答は render に直接書くとは限らない。ここを見ないと、ハッシュを一度変数に
      # 逃がすだけで例外メッセージの露出が件数から消える。
      #
      # render は必ず何らかのアクションメソッドの中に書く（実際のコントローラと同じ形）。
      # ローカル変数への代入は render 呼び出しと同じメソッドの範囲に限って探すため、
      # メソッドの外の裸の代入文では対象にならない。
      source = <<~RUBY
        def create
          payload = { error: e.message }
          payload[:resyncRequired] = true
          render json: payload, status: :conflict
        end
      RUBY

      expect(classify(source).map(&:first)).to eq([ :exception_message ])
    end

    it "応答に載らない error は対象外" do
      # KPI のペイロードやログの引数に error という名前を使っただけで応答と同じ扱いを
      # すると、利用者に一切出ないコードのためにダイジェストの作り直しを強いられる。
      source = <<~RUBY
        KpiEvent.create!(props: { error: "internal detail" })
        logger.warn(error: e.message)
      RUBY

      expect(classify(source)).to be_empty
    end

    it "カタログ参照や変数は違反として扱わない" do
      # I18n.t に渡すキーは文言ではない。第二引数以降に直書きした文字列は拾う。
      source = <<~RUBY
        render json: { error: I18n.t("api.errors.example") }, status: :x
        render json: { error: message }, status: :x
        render json: { error: e.record.errors.full_messages.to_sentence }, status: :x
      RUBY

      expect(classify(source)).to be_empty
    end

    it "キーワード引数の順を入れ替えても検出する" do
      # 深さ 0 で行が変わったところで走査を打ち切ると、status を先に書いて本体を
      # 次の行に置くだけで検査から外れる。書き方を変えるだけで抜けられる検査は、
      # 「違反ゼロ」が「無かった」ではなく「見ていない」を意味することになる。
      source = <<~RUBY
        render status: :unprocessable_content,
               json: { error: "Board or object not found" }
      RUBY

      expect(classify(source)).to eq([ [ :literal, "Board or object not found" ] ])
    end

    it "同じファイルのヘルパーが返す文言も検出する" do
      # 文言をヘルパーメソッドに移すだけで台帳から消えると、「直書きは無い」という
      # 報告が、直書きのあるコントローラに対して出てしまう。
      source = <<~RUBY
        def show
          render json: { error: not_found_message }, status: :not_found
        end

        def not_found_message
          "Board or object not found"
        end
      RUBY

      expect(classify(source)).to eq([ [ :literal, "Board or object not found" ] ])
    end

    it "2段先のヘルパーが返す文言も検出する" do
      # 1段しか辿らないと、ヘルパーがさらに別のヘルパーを呼ぶ形に文言を逃がすだけで
      # 台帳から消える。
      source = <<~RUBY
        def show
          render json: { error: outer_message }, status: :not_found
        end

        def outer_message
          inner_message
        end

        def inner_message
          "Board not found"
        end
      RUBY

      expect(classify(source)).to eq([ [ :literal, "Board not found" ] ])
    end

    it "仮引数の宣言をヘルパー呼び出しの候補として扱わない" do
      # def outer(x) の "x" は仮引数の宣言であって呼び出しではない。ここを除かないと、
      # 呼ばれてもいない無関係な def x の中身まで、たまたま名前が重なるだけで
      # 応答文言として拾ってしまう（Codex レビュー指摘）。
      source = <<~RUBY
        def show
          render json: { error: outer(1) }, status: :not_found
        end

        def outer(x)
          "direct"
        end

        def x
          "unrelated, never called"
        end
      RUBY

      expect(classify(source)).to eq([ [ :literal, "direct" ] ])
    end

    it "仮引数と同名でも、明示的な呼び出しは実メソッドとして辿る" do
      # def outer(message); message(); end の "message()" は、仮引数 message の有無に
      # 関わらず実際には同名メソッド message を呼び出す（Ruby の実際の挙動）。
      # 仮引数名を丸ごと候補から差し引く実装だと、この実在する呼び出しを取りこぼす
      # false negative になる（Codex レビュー指摘）。
      source = <<~RUBY
        def show
          render json: { error: outer }, status: :not_found
        end

        def outer(message)
          message()
        end

        def message
          "Board not found"
        end
      RUBY

      expect(classify(source)).to eq([ [ :literal, "Board not found" ] ])
    end

    it "カッコ無しで引数を渡すコマンド形式の呼び出しも辿る" do
      # `inner 1` は Ripper では :fcall ではなく :command になる。この形を見落とすと、
      # 間接的に応答へ出る直書き文言を検査から隠せる（Codex レビュー指摘）。
      source = <<~RUBY
        def show
          render json: { error: outer }, status: :not_found
        end

        def outer
          inner 1
        end

        def inner(x)
          "from inner"
        end
      RUBY

      expect(classify(source)).to eq([ [ :literal, "from inner" ] ])
    end

    it "ローカル変数への束縛は、render 呼び出しと同じメソッドの範囲に限って探す" do
      # ファイル全体から同名の代入を拾うと、応答と無関係な別メソッドのローカル変数まで
      # 応答文言として誤検出する（Codex レビュー指摘）。
      source = <<~RUBY
        def show
          render json: { error: message }, status: :not_found
        end

        def audit
          message = "internal only, never rendered"
          Rails.logger.info(message)
        end
      RUBY

      expect(classify(source)).to eq([])
    end

    it "ローカル変数の読み出しや外部レシーバのセレクタをヘルパー呼び出しとして扱わない" do
      # message = service.detail; message は、後半の裸の "message" がローカル変数の
      # 読み出し（Ruby の実際の挙動）であって呼び出しではない。また "service.detail" の
      # "detail" は service というレシーバのメソッドで、このファイルの同名メソッドとは
      # 無関係。どちらも候補にすると、無関係な def message / def detail の中身まで
      # 応答文言として拾ってしまう false positive になる（Codex レビュー指摘）。
      source = <<~RUBY
        def show
          render json: { error: helper }, status: :not_found
        end

        def helper
          message = service.detail
          message
        end

        def message
          "unrelated, never called"
        end

        def detail
          "also unrelated"
        end
      RUBY

      expect(classify(source)).to eq([])
    end

    it "例外露出の identity にファイル内で囲むクラス名を含める" do
      # メソッド名だけを identity にすると、同じファイルの異なるクラスにある同名メソッドの
      # 間で e.message の露出を入れ替えても identity の集合が変わらず、新しい露出を
      # 見逃す（Codex レビュー指摘）。
      before_swap = <<~RUBY
        class Foo
          def show
            render json: { error: e.message }, status: :x
          end
        end

        class Bar
          def show
            render json: { error: "static" }, status: :x
          end
        end
      RUBY

      after_swap = <<~RUBY
        class Foo
          def show
            render json: { error: "static" }, status: :x
          end
        end

        class Bar
          def show
            render json: { error: e.message }, status: :x
          end
        end
      RUBY

      identities_before = RubyTokenScanner.scan(before_swap).render_values.select { |v| v.kind == :exception_message }.map(&:value)
      identities_after = RubyTokenScanner.scan(after_swap).render_values.select { |v| v.kind == :exception_message }.map(&:value)

      expect(identities_before).to eq([ "Foo#show" ])
      expect(identities_after).to eq([ "Bar#show" ])
    end

    it "補間に埋め込んだ例外メッセージの identity も囲むメソッドで区別する" do
      # "失敗: \#{e.message}" のように補間の中にある e.message は、値が固定部分
      # （"失敗: "）のままだと、露出元を別のメソッドへ移しても固定部分が同じなら
      # ダイジェストが変わらず、入れ替えを見逃す（Codex レビュー指摘）。
      before_swap = <<~'RUBY'
        class Foo
          def show
            render json: { error: "失敗: #{e.message}" }, status: :x
          end
        end

        class Bar
          def show
            render json: { error: "static" }, status: :x
          end
        end
      RUBY

      after_swap = <<~'RUBY'
        class Foo
          def show
            render json: { error: "static" }, status: :x
          end
        end

        class Bar
          def show
            render json: { error: "失敗: #{e.message}" }, status: :x
          end
        end
      RUBY

      identities_before = RubyTokenScanner.scan(before_swap).render_values.select { |v| v.kind == :exception_message }.map(&:value)
      identities_after = RubyTokenScanner.scan(after_swap).render_values.select { |v| v.kind == :exception_message }.map(&:value)

      expect(identities_before).to eq([ "Foo#show" ])
      expect(identities_after).to eq([ "Bar#show" ])
    end

    it "クラス identity は名前空間まで含めた完全修飾名にする" do
      # 最後の定数名だけだと、別の名前空間にある同名クラスを区別できず、
      # その間での例外メッセージ露出の入れ替えを見逃す（Codex レビュー指摘）。
      # class A::Controller という1宣言の形と、module ネストの両方を確かめる。
      source = <<~RUBY
        class A::Controller
          def show
            render json: { error: e.message }, status: :x
          end
        end

        module B
          class Controller
            def show
              render json: { error: e.message }, status: :x
            end
          end
        end
      RUBY

      identities = RubyTokenScanner.scan(source).render_values.select { |v| v.kind == :exception_message }.map(&:value)

      expect(identities).to contain_exactly("A::Controller#show", "B::Controller#show")
    end

    it "定数やローカル変数に束縛してから返す文言も検出する" do
      # NOT_FOUND = "..." や message = "..." のように、いったんスカラーの文字列に
      # 束縛してから render に渡すだけで台帳から消えると、変数名を変えるだけで
      # 検査から外れることになる。
      source = <<~RUBY
        NOT_FOUND = "Board not found"

        def show
          render json: { error: NOT_FOUND }, status: :not_found
        end

        def create
          message = "Comment could not be recorded"
          render json: { error: message }, status: :internal_server_error
        end
      RUBY

      expect(classify(source)).to contain_exactly(
        [ :literal, "Board not found" ],
        [ :literal, "Comment could not be recorded" ]
      )
    end

    it "%w[] 形式の文言も検出する" do
      # %w[...] は :on_tstring_beg を経由しないため、STRING_OPEN に含めないと
      # 素通りする。
      expect(classify('render json: { errors: %w[BoardNotFound] }, status: :not_found'))
        .to eq([ [ :literal, "BoardNotFound" ] ])
    end

    it "ファイル内でクラスをまたいだ同名メソッドも取りこぼさない" do
      # メソッド名だけをキーにして最後の定義で上書きすると、応答に載る側の定義が
      # 別クラスの同名メソッドに隠れて検査から消える。
      source = <<~RUBY
        class Internal
          def message
            "internal detail, never rendered"
          end
        end

        def show
          render json: { error: message }, status: :not_found
        end

        def message
          "Board not found"
        end
      RUBY

      expect(classify(source)).to include([ :literal, "Board not found" ])
    end

    it "ヘルパーの中のログと raise は文言として数えない" do
      # ヘルパーの本体まで走査するようになった分、利用者に出ない文字列を巻き込みやすい。
      # ログと raise は応答に載らず、載せるかどうかは受け側の判断なのでそちらで数える。
      source = <<~'RUBY'
        def create
          render json: { error: invalid_body_message(e) }, status: :unprocessable_content
        end

        def invalid_body_message(error)
          logger.warn("[CommentsController] #{error.message}")
          raise ArgumentError, "internal detail" if error.nil?

          I18n.t("api.errors.invalid_comment_body")
        end
      RUBY

      expect(classify(source)).to be_empty
    end

    it "例外以外への to_s を露出として数えない" do
      # 値式のどこかに to_s があるかだけを見ると、カタログ参照の補間まで露出として
      # 数える。件数の枠が偽陽性で埋まると、本物の露出をその枠が覆い隠す。
      expect(classify('render json: { error: I18n.t("api.errors.example", value: params[:intensity].to_s) }, status: :x'))
        .to be_empty
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
