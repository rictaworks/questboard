require "ripper"
require "set"

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

  # %w[...] / %W[...] も文字列の入れ物として扱う。render json: { errors: %w[BoardNotFound] }
  # のような書き方は :on_tstring_beg を経由しないため、これが無いと素通りする。
  STRING_OPEN = [ :on_tstring_beg, :on_heredoc_beg, :on_qwords_beg, :on_words_beg ].freeze
  # 開始トークンごとに対応する終端の種別。%w[...] / %W[...] はヒアドキュメントと違って
  # 専用の終端種別（:on_qwords_end 等）を持たず、通常の文字列と同じ :on_tstring_end で
  # 閉じる（Ripper.lex で実測して確認済み）。載っていないものは :on_tstring_end とみなす。
  CLOSING_TOKEN_TYPE = {
    on_heredoc_beg: :on_heredoc_end
  }.freeze

  # render の引数に現れる識別子として辿る種類。ローカル変数（:on_ident）だけでなく、
  # NOT_FOUND = "..." のような定数（:on_const）に束縛した文言も追う。
  IDENTIFIER_TYPES = [ :on_ident, :on_const ].freeze

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
    tree = Ripper.sexp(source)
    raise ArgumentError, "構文解析できないソースを走査しようとしている" if tree.nil?

    Scanned.new(
      Ripper.lex(source).map { |(line, _column), type, value, _state| Token.new(line, type, value) },
      collect_method_line_ranges(tree, {}),
      collect_class_line_ranges(tree, [])
    )
  end

  # メソッド名 => { 本体が占める行の範囲, 仮引数名の集合 } の配列。
  #
  # def から対応する end までをトークン列で数えるには、後置の if / while を区別するために
  # 字句の状態まで見る必要があり、間違えると範囲が静かにずれる。構文木なら定義そのものを
  # 取り出せるため、Ripper.sexp を使う。
  #
  # 値を配列で持つのは、1ファイルにクラスをまたいで同名メソッドがあり得るため。
  # 単一の値で持って後勝ちにすると、応答に載る側の定義がもう片方に上書きされて
  # 検査から消える。全件を辿れば、無関係な同名メソッドまで巻き込む分だけ安全側に倒れる。
  #
  # 仮引数名を別に持つのは、本体の走査で「呼び出しているように見える識別子」を拾うときに
  # 仮引数の宣言そのもの（呼び出しではない）を除くため。除かないと、たまたま仮引数と
  # 同名の無関係なメソッドがファイル内にあるだけで、呼ばれてもいないその本体まで
  # 応答文言として拾ってしまう。
  #
  # called_names は本体の中で実際に呼んでいる（仮引数・ローカル変数の参照ではない）
  # 名前の集合。Ripper.sexp は「その識別子がローカル変数として見えているか」を
  # 構文解析の時点で解決しているため、トークン列の見た目（次に "(" があるか等）に
  # 頼るより正確に「呼び出しである」ことを判定できる。
  #   def outer(message); message; end     … message は :var_ref（仮引数の参照）→ 対象外
  #   def outer(message); message(); end   … message は :fcall（実呼び出し）→ 対象に含める
  # 仮引数の名前を丸ごと候補から差し引く方式だと、後者のような「同名の仮引数があっても
  # 明示的な呼び出しは仮引数を無視して実メソッドを呼ぶ」という Ruby の実際の挙動を
  # 見逃す（本当に応答へ出る文言を取りこぼす false negative になる）。
  def collect_method_line_ranges(node, collected)
    return collected unless node.is_a?(Array)

    if node.first == :def && node[1].is_a?(Array) && node[1].first == :@ident
      lines = node_lines(node)
      unless lines.empty?
        entry = { range: (lines.min..lines.max), called_names: collect_called_names(node[3]) }
        (collected[node[1][1]] ||= []) << entry
      end
    end

    node.each { |child| collect_method_line_ranges(child, collected) }
    collected
  end

  # 構文木から「実際に呼び出している、レシーバの無い識別子」の名前を集める。
  #   :vcall         … 引数もカッコも無い裸の呼び出し（ローカル変数ではないと解決済み）
  #   :fcall         … カッコ付き、または `foo(1)` のように丸カッコで引数を渡す裸の呼び出し
  #   :command       … `foo 1` のようにカッコ無しで引数を渡す裸の呼び出し（Ripper では
  #                    :fcall と別の種別になる）。引数側にも呼び出しが含まれ得るため、
  #                    引数の部分木も辿る。
  #   :call          … レシーバ付きの呼び出し（foo.bar）。レシーバ側（foo）は辿るが、
  #                    セレクタ（bar）は別のオブジェクトのメソッドであり、このファイルの
  #                    同名メソッドとは無関係なので候補にしない。
  #   :command_call  … レシーバ付きでカッコ無しの呼び出し（foo.bar 1）。:call と同じ理由で
  #                    セレクタは候補にしないが、引数側は辿る。
  # :var_ref（ローカル変数・仮引数の読み出し）は候補にしない。
  def collect_called_names(node, collected = [])
    return collected unless node.is_a?(Array)

    case node.first
    when :vcall, :fcall
      collected << node[1][1] if node[1].is_a?(Array) && node[1].first == :@ident && node[1][1].is_a?(String)
    when :command
      collected << node[1][1] if node[1].is_a?(Array) && node[1].first == :@ident && node[1][1].is_a?(String)
      collect_called_names(node[2], collected)
      return collected
    when :call
      collect_called_names(node[1], collected)
      return collected
    when :command_call
      collect_called_names(node[1], collected)
      collect_called_names(node[4], collected)
      return collected
    else
      node.each { |child| collect_called_names(child, collected) }
    end

    collected
  end

  # 完全修飾のクラス／モジュール名 => 本体が占める行の範囲の配列。同名メソッドの識別を、
  # 囲むクラス／モジュール名まで含めて一意にするために使う（メソッド名だけでは、
  # 同じファイルの異なるクラスにある同名メソッドを区別できない）。
  #
  # namespace は字句的に外側で開いている module/class の名前列。`class A::Controller`
  # という1つの宣言の中の複数の定数（A・Controller）だけでなく、
  # `module A; class Controller; end; end` のようなレキシカルな入れ子も両方とも
  # "A::Controller" に畳み込む。最後の定数名だけを使うと、別の名前空間にある
  # 同名クラスが区別できず、その間での例外メッセージ露出の入れ替えを見逃す。
  def collect_class_line_ranges(node, collected, namespace = [])
    return collected unless node.is_a?(Array)

    if [ :class, :module ].include?(node.first)
      local_segments = const_names_in(node[1])
      full_name = (namespace + local_segments).join("::")
      lines = node_lines(node)
      collected << { name: full_name, range: (lines.min..lines.max) } if !full_name.empty? && !lines.empty?

      node.each { |child| collect_class_line_ranges(child, collected, namespace + local_segments) }
    else
      node.each { |child| collect_class_line_ranges(child, collected, namespace) }
    end

    collected
  end

  # class A::Controller のような宣言では :@const が複数（A・Controller の順）現れる。
  # すべて集めて、外側から内側の順に並べる。
  def const_names_in(node, names = [])
    return names unless node.is_a?(Array)

    names << node[1] if node.first == :@const && node[1].is_a?(String)
    node.each { |child| const_names_in(child, names) }
    names
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

    def initialize(tokens, method_line_ranges, class_line_ranges)
      @tokens = tokens
      @method_line_ranges = method_line_ranges
      @class_line_ranges = class_line_ranges
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
    # 応答は render に直接書くとは限らない。次の3つの間接も辿る。
    #   payload = { error: e.message }        … render json: payload
    #   NOT_FOUND = "Board not found"         … render json: { error: NOT_FOUND }
    #   message = "Board not found"           … render json: { error: message }
    #   render json: { error: not_found_message }（同じファイルに def がある呼び出し。
    #     ヘルパーがさらに別のヘルパーを呼ぶ形も、呼び出しの連鎖をたどって拾う）
    # ログや raise、カタログのキーは利用者に出る文言ではないため、直前の呼び出しの名前で除く。
    def render_values
      (
        values_in_render_arguments + values_in_rendered_hashes +
        values_bound_to_rendered_identifiers + values_in_called_helpers
      ).sort_by(&:line)
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
      values = []
      each_rendered_identifier { |name, scope| values.concat(values_in_hash_assigned_to(name, scope)) }
      values
    end

    # NOT_FOUND = "Board not found" / message = "Board not found" のように、スカラーの
    # 文字列に束縛してから render に渡す形を辿る。ハッシュへの代入は
    # values_in_hash_assigned_to が別に見ているので、ここでは文字列の代入だけを見る。
    def values_bound_to_rendered_identifiers
      values = []
      each_rendered_identifier { |name, scope| values.concat(values_bound_to(name, scope)) }
      values
    end

    # scope は :unscoped（定数。ファイル全体から探す）、Range（ローカル変数。render 呼び出しと
    # 同じメソッドの行範囲に限る）、:none（ローカル変数だが render 呼び出しがどのメソッドにも
    # 属していない＝安全に絞り込めないので探さない）のいずれか。
    #
    # ローカル変数名をファイル全体から探すと、応答とは無関係な別メソッドにある同名の
    # ローカル変数への代入まで拾ってしまう（例: show で render json: { error: message } を
    # 使い、別の audit メソッドで message = "internal only" と代入した場合、その内部文字列が
    # 応答文言として検出される）。メソッドの外に出ない変数の性質上、対応する render 呼び出しと
    # 同じメソッドの範囲だけを見れば十分で、かつそれ以上は探索してはならない。
    def values_bound_to(name, scope)
      return [] if scope == :none

      @significant.each_with_index.flat_map do |token, index|
        next [] unless IDENTIFIER_TYPES.include?(token.type) && token.value == name
        next [] if scope.is_a?(Range) && !scope.cover?(token.line)
        next [] unless @significant[index + 1]&.type == :on_op && @significant[index + 1].value == "="
        next [] unless STRING_OPEN.include?(@significant[index + 2]&.type)

        finish = string_end_index(@significant, index + 2)
        [ render_value_for(@significant[(index + 2)..finish]) ]
      end
    end

    # render の引数から呼んでいる、同じファイルで定義されたメソッドの本体を走査する。
    # ここを見ないと、文言をヘルパーメソッドに移すだけで台帳から消える。
    # ヘルパーがさらに別のヘルパーを呼ぶ形も辿る（多段）。呼び出しが自分自身に戻る循環は
    # visited で止める。メソッド名はファイル全体で一意な名前空間なので、
    # values_bound_to / values_in_hash_assigned_to と違ってスコープの絞り込みは要らない。
    def values_in_called_helpers
      rendered_identifiers.flat_map { |name| values_from_helper(name, Set.new) }
    end

    def values_from_helper(name, visited)
      return [] if visited.include?(name)

      entries = @method_line_ranges[name]
      return [] if entries.nil?

      visited = visited | [ name ]

      entries.flat_map do |entry|
        body = @significant.select { |token| entry[:range].cover?(token.line) }
        direct = values_in(body)
        # called_names は collect_method_line_ranges が Ripper.sexp から拾った、
        # 「実際に呼び出している（ローカル変数・仮引数の参照ではない）」名前の集合。
        nested = entry[:called_names].reject { |called| called == name }
          .select { |called| @method_line_ranges.key?(called) }
          .flat_map { |called| values_from_helper(called, visited) }

        direct + nested
      end
    end

    # render に値として渡している識別子。変数名・定数名（後続の代入を辿る）と、同じファイルで
    # 定義されたメソッド名（本体を辿る）の両方に使う。レシーバ（後ろがピリオド／&.）は
    # それ自体が値ではないため除く。セレクタ（前がピリオド／&.、つまり foo.bar の "bar"）も
    # 除く。それは foo というレシーバのメソッドであり、このファイルの同名メソッドとは
    # 無関係なので、無関係な helper として辿ってしまう。
    def rendered_identifiers
      names = []
      each_rendered_identifier { |name, _scope| names << name }
      names.uniq
    end

    # render の引数に現れる識別子を、対応する代入探索の scope と一緒に列挙する。
    #   :on_const … :unscoped（定数はメソッドに閉じないため、ファイル全体を探す）
    #   :on_ident … render 呼び出し自身を囲むメソッドの行範囲（無ければ :none）
    def each_rendered_identifier
      render_argument_spans.each do |span|
        span.each_with_index do |token, index|
          next unless IDENTIFIER_TYPES.include?(token.type)
          next if receiver_marker?(span[index + 1])
          next if index.positive? && receiver_marker?(span[index - 1])

          scope = token.type == :on_const ? :unscoped : (enclosing_method_range(span.first.line) || :none)
          yield(token.value, scope)
        end
      end
    end

    # レシーバの直後に来る「メソッド呼び出しの印」。&. も . と同じくレシーバであることを
    # 示すが、Ripper では :on_op（値 "&."）として別のトークン種別になる。ここを見落とすと
    # `lock&.locked_by` の "lock" が値そのものと誤認され、たまたま同名のメソッド
    # （例: アクション def lock）が無関係な helper として辿られてしまう。
    def receiver_marker?(token)
      return false if token.nil?

      token.type == :on_period || (token.type == :on_op && token.value == "&.")
    end

    # scope の意味は values_bound_to と同じ。
    def values_in_hash_assigned_to(name, scope)
      return [] if scope == :none

      @significant.each_with_index.flat_map do |token, index|
        next [] unless IDENTIFIER_TYPES.include?(token.type) && token.value == name
        next [] if scope.is_a?(Range) && !scope.cover?(token.line)
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
          unless ignored_argument?(tokens, index)
            # 値は空文字ではなく、囲むクラス／モジュール名とメソッド名を持たせる。件数だけで
            # 台帳を持つと、あるメソッドの露出をやめて別のメソッドに新しい露出を足す
            # 差し引きゼロの入れ替えを見逃す。メソッド名だけでも、同じファイルの異なる
            # クラスに同名メソッドがあると区別できない（一方から削って他方に足しても
            # identity が変わらない）ため、クラス／モジュール名まで含める。
            values << RenderValue.new(token.line, :exception_message, exception_identity(token.line))
          end
          # 受け手・ピリオド・メソッド名の3つを消費する。
          index += 3
        else
          index += 1
        end
      end

      values
    end

    def exception_identity(line)
      [ enclosing_class_name(line), enclosing_method_name(line) ].compact.join("#")
    end

    def enclosing_method_name(line)
      enclosing_method_entry(line)&.first
    end

    def enclosing_method_range(line)
      enclosing_method_entry(line)&.last&.fetch(:range)
    end

    def enclosing_method_entry(line)
      @method_line_ranges.each do |name, entries|
        entry = entries.find { |candidate| candidate[:range].cover?(line) }
        return [ name, entry ] if entry
      end

      nil
    end

    # 複数のクラス／モジュールが同じ行を覆う（入れ子の）場合は、最も範囲の狭いもの＝
    # 最も内側の定義を採用する。
    def enclosing_class_name(line)
      @class_line_ranges.select { |entry| entry[:range].cover?(line) }
        .min_by { |entry| entry[:range].size }
        &.fetch(:name)
    end

    def render_value_for(span)
      line = span.first.line

      if exception_message_in?(span)
        # "失敗: #{e.message}" のように補間の中に例外メッセージがある場合、値は
        # literal_text（補間の外側だけの固定文字列）ではなく exception_identity にする。
        # 固定部分は identity ではないため、それだけで持つと、露出元を別のメソッドへ
        # 移しても固定部分が同じなら台帳のダイジェストが変わらず、入れ替えを見逃す。
        RenderValue.new(line, :exception_message, exception_identity(line))
      else
        RenderValue.new(line, :literal, literal_text(span))
      end
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
      closing = CLOSING_TOKEN_TYPE.fetch(tokens[index].type, :on_tstring_end)
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
    # %w[a b] は語ごとに :on_tstring_content が分かれ、間を :on_words_sep がつなぐため、
    # 区切りを空白として残す（そのまま結合すると語がくっついて読めなくなる）。
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
        when :on_words_sep
          " " if interpolation.zero?
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
