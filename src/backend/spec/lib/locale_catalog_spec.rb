require "rails_helper"
require_relative "../support/backend_source_tree"
require_relative "../support/japanese_text"
require_relative "../support/ruby_token_scanner"

# 表示言語は日本語のみ（CLAUDE.md）。default_locale は :ja で、production の
# config.i18n.fallbacks は I18n.default_locale へ落とす設定なので、:ja のフォールバック先は
# :ja 自身になる。つまり :ja に無いキーは英語に落ちるのではなく
# "Translation missing: ja.…" という文字列になり、そのまま API のエラー本文や
# 例外メッセージ（＝ログ）に出る。
#
# 個別の request spec は「その経路で使われるキー」しか踏まないため、まだ使っていない
# バリデーションのキーが欠けていても緑のまま通る。欠落は本番で初めて表面化する。
# そのため、カタログ側の網羅性をここで直接検査する。
# 検証モジュールの置き場所を規約から推測していないことを確かめるためだけのモジュール。
# app/models/concerns/ の外にあり、ファイル名もモジュール名と一致しない。
# stub_const で作ると定義位置が rspec-mocks 側になってしまうため、ここに置く。
module LocaleCatalogSpecValidations; end

# バリデータクラスからの errors.add も走査していることを確かめるためだけのバリデータ。
# app/validators に置いた実物と同じく、モデルの ancestors には現れない。
class LocaleCatalogSpecValidator < ActiveModel::EachValidator
  def validate_each(record, attribute, _value)
    record.errors.add(attribute, :locale_catalog_spec_example)
  end
end

RSpec.describe "日本語ロケールカタログ" do
  # 解決できなかったことを確実に見分けるためのセンチネル。I18n.t は既定で
  # "Translation missing: …" という *文字列* を返すため、戻り値を見ただけでは
  # 正常な翻訳と区別しづらい。
  def missing_sentinel
    "<<TRANSLATION MISSING>>"
  end

  def translation(key, **options)
    I18n.t(key, default: missing_sentinel, **options)
  end

  # ネストしたカタログを "a.b.c" 形式のキー列に平坦化する。
  def leaf_keys(node, prefix = [])
    return [ prefix.join(".") ] unless node.is_a?(Hash)

    node.flat_map { |key, value| leaf_keys(value, prefix + [ key ]) }
  end

  # leaf_keys と違い、値の無いキー（YAML 上の nil）を葉として数えない。
  # ja.yml では値の無いキーは「翻訳が書かれていない」ことを意味するので
  # leaf_keys が拾って解決検査に載せる必要があるが、こちらは「文言が置かれているか」を
  # 見るためのもので、値の無いキーは置かれていないものとして扱う。
  def translation_keys(node, prefix = [])
    return [] if node.nil?
    return [ prefix.join(".") ] unless node.is_a?(Hash)

    node.flat_map { |key, value| translation_keys(value, prefix + [ key ]) }
  end

  # 対象は app/models で定義されたモデル。マイグレーションの中で定義される一時的な
  # モデルクラス（BackfillXxx::MigrationYyy など）は利用者に見せるものではない。
  #
  # 判定はテーブルの有無ではなく定義された場所で行う。table_exists? で絞ると、
  # テーブルが用意できていないアプリのモデルまで黙って検査から外れる。
  # ファイル名との一致で絞るのも不可。1つのファイルに STI の子クラスを書くと、
  # 同名ファイルが無いという理由だけで検査から外れてしまう。
  def model_definition_path(model)
    # 名前の無いクラスは const_source_location に渡せない（TypeError になる）。
    return nil if model.name.nil?

    location = Object.const_source_location(model.name)&.first
    location && Pathname.new(location)
  end

  def application_model?(model)
    # db/seeds.rb は投入するテーブルごとに Class.new(ApplicationRecord) を作る。
    # 名前が無いクラスは const_source_location に渡せないうえ、検査対象でもない。
    return false if model.name.nil?

    path = model_definition_path(model)
    path&.to_s&.start_with?(BackendSourceTree.root.join("app/models").to_s) || false
  end

  def validated_models
    Rails.application.eager_load!
    ActiveRecord::Base.descendants
      .reject(&:abstract_class?)
      .select { |model| application_model?(model) }
      .sort_by(&:name)
  end

  # model.validators に現れるのは validates で宣言した属性だけで、カスタムの validate
  # メソッドの中で errors.add している属性は含まれない。そこだけ和名が無いと
  # 「Deleted atを入力してください」のような半英語の文言が緑のまま出荷される。
  # 宣言からは辿れないため、モデルのソースから errors.add の第一引数を拾う。
  #
  # モデル本体のファイルだけを見ると、検証を concern に切り出した時点で検査から外れる。
  # 実際に読み込まれている祖先モジュールのファイルまで含めて走査する。
  #
  # モジュールの場所も名前から推測しない。app/models/concerns/<名前>.rb という置き方を
  # 前提にすると、それ以外の場所に置いた検証モジュールが「そのパスに実在しない」という
  # 理由だけで黙って検査から外れる。gem が提供するモジュールは対象外なので、
  # このリポジトリ配下のファイルに限る。
  def model_source_paths(model)
    root = BackendSourceTree.root
    candidates = [ model_definition_path(model) ].compact

    model.ancestors.each do |ancestor|
      next if ancestor.is_a?(Class) || ancestor.name.nil?
      next unless resolvable_constant_name?(ancestor.name)

      location = Object.const_source_location(ancestor.name)&.first
      candidates << Pathname.new(location) if location
    end

    # バリデータはモジュールではなくクラスで、モデルの ancestors にも現れない。
    # ここを見ないと、検証を app/validators に切り出した時点で errors.add が
    # 検査から外れ、メッセージのシンボルが未定義でも緑のまま通る。
    model.validators.each do |validator|
      name = validator.class.name
      next if name.nil? || !resolvable_constant_name?(name)

      location = Object.const_source_location(name)&.first
      candidates << Pathname.new(location) if location
    end

    candidates.uniq.select { |path| path.file? && path.to_s.start_with?(root.to_s) }
  end

  # ActiveRecord は関連ごとに #<Class:0x…>::GeneratedAssociationMethods のような
  # 定数として辿れない名前のモジュールを差し込む。const_source_location はそういう名前を
  # NameError で弾くため、渡す前にふるい落とす。
  def resolvable_constant_name?(name)
    name.match?(/\A[A-Z]\w*(::[A-Z]\w*)*\z/)
  end

  def errors_add_pairs(model)
    model_source_paths(model).flat_map { |path| RubyTokenScanner.scan(path.read).errors_add_pairs }.uniq
  end

  def errors_add_attributes(model)
    errors_add_pairs(model).map(&:first).uniq
  end

  def validated_attributes(model)
    (model.validators.flat_map(&:attributes) + errors_add_attributes(model)).uniq.sort
  end

  it "バリデーション対象の属性はすべて日本語の項目名を持つ" do
    offenders = validated_models.flat_map do |model|
      validated_attributes(model).filter_map do |attribute|
        human = model.human_attribute_name(attribute)
        next if JapaneseText.japanese?(human)

        "  #{model.name}##{attribute} => #{human.inspect}"
      end
    end

    expect(offenders).to be_empty, <<~MESSAGE
      バリデーション対象の属性に日本語の項目名が無い。
      errors.full_messages は「項目名 + メッセージ」で組み立てられるため、
      このままだと「Board objectを入力してください」のように英語が混ざったまま利用者に出る。
      config/locales/ja.yml の activerecord.attributes に追加すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  it "Rails 本体が使う日本語メッセージのキーが揃っている" do
    # ActiveModel / ActiveRecord が組み込みバリデーションで引くキー。rails-i18n が
    # 供給しているため通常は揃っているが、gem を外したり locale の読み込み順を変えたときに
    # ここが赤くなる。
    keys = %w[
      errors.format
      errors.messages.blank
      errors.messages.present
      errors.messages.required
      errors.messages.inclusion
      errors.messages.exclusion
      errors.messages.invalid
      errors.messages.taken
      errors.messages.confirmation
      errors.messages.accepted
      errors.messages.not_a_number
      errors.messages.not_an_integer
      errors.messages.greater_than
      errors.messages.greater_than_or_equal_to
      errors.messages.less_than
      errors.messages.less_than_or_equal_to
      errors.messages.equal_to
      errors.messages.other_than
      errors.messages.odd
      errors.messages.even
      errors.messages.too_long
      errors.messages.too_short
      errors.messages.wrong_length
      activerecord.errors.messages.record_invalid
      activerecord.errors.messages.restrict_dependent_destroy.has_one
      activerecord.errors.messages.restrict_dependent_destroy.has_many
    ]

    # count / attribute などの補間が要るキーがあるため、まとめて渡す。足りないと
    # I18n::MissingInterpolationArgument で落ちるので、補間漏れもここで検知できる。
    missing = keys.reject do |key|
      translation(key, count: 1, attribute: "属性", message: "メッセージ", record: "レコード", model: "モデル", errors: "エラー") != missing_sentinel
    end

    expect(missing).to be_empty, <<~MESSAGE
      日本語カタログに無いキーがある。default_locale が :ja のため、
      これらは "Translation missing: ja.…" として利用者とログに出る。

      #{missing.join("\n")}
    MESSAGE
  end

  it "複数のエラーを日本語の読点で連結する" do
    # errors.full_messages.to_sentence は 14 箇所の rescue で使っている。
    # support.array が無いと ActiveSupport がハードコードの英語（" and "）で連結する。
    expect([ "あ", "い" ].to_sentence).to eq("あ、い")
    expect([ "あ", "い", "う" ].to_sentence).to eq("あ、い、う")
  end

  it "RecordInvalid の例外メッセージが原因を保持している" do
    # kpi_events_controller#create のように rescue を持たない経路では、この文言だけが
    # ログに残る。ここが壊れると 500 の原因調査ができなくなる。
    error = nil
    begin
      Comment.create!(body: "")
    rescue ActiveRecord::RecordInvalid => e
      error = e
    end

    expect(error).not_to be_nil
    expect(error.message).not_to include("Translation missing")
    expect(error.message).to include("コメント")
  end

  it "すべてのモデルが日本語のモデル名を持つ" do
    # restrict_dependent_destroy などは %{record} にモデル名を差し込む。ここが未定義だと
    # 「User settingsが存在しているので削除できません」のような半英語の文言になる。
    offenders = validated_models.filter_map do |model|
      human = model.model_name.human
      next if JapaneseText.japanese?(human)

      "  #{model.name} => #{human.inspect}"
    end

    expect(offenders).to be_empty, <<~MESSAGE
      日本語のモデル名が無い。config/locales/ja.yml の activerecord.models に追加すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  it "モデル名を差し込むメッセージが日本語で組み立つ" do
    # キーの存在だけを見ていると、補間の中身が英語のまま残っていても緑になる。
    message = I18n.t(
      "activerecord.errors.messages.restrict_dependent_destroy.has_many",
      record: UserSetting.model_name.human(count: :many)
    )

    expect(message).to eq("ユーザー設定が存在しているので削除できません")
  end

  it "app/models にある ActiveRecord のモデルをすべて検査している" do
    # 検査対象が減っていることに気付けないと、違反ゼロという結果が「無かった」ではなく
    # 「見ていない」を意味してしまう。
    #
    # ファイル一覧との完全一致は求めない。翻訳と関係のない素のクラス（値オブジェクトや
    # フォームオブジェクトなど）を app/models に置いただけで、このロケールの spec が
    # パスの差分を示して赤くなり、i18n の spec を編集して除外する羽目になる。
    covered = validated_models.filter_map { |model| model_definition_path(model)&.to_s }.uniq

    uncovered = BackendSourceTree.ruby_paths("app/models")
      .reject { |path| path.to_s.include?("/concerns/") }
      .reject { |path| path.basename.to_s == "application_record.rb" }
      .reject { |path| covered.include?(path.to_s) }
      .select { |path| path.read.include?("ApplicationRecord") }

    # 走査が空振りしていれば、漏れゼロは「無かった」ではなく「見ていない」を意味する。
    expect(covered).not_to be_empty

    expect(uncovered).to be_empty, <<~MESSAGE
      ActiveRecord のモデルを定義しているのに検査対象に入っていないファイルがある。
      eager_load で読み込まれていないか、ApplicationRecord を継承していない可能性がある。

      #{uncovered.map { |path| "  #{BackendSourceTree.relative(path)}" }.join("\n")}
    MESSAGE
  end

  it "名前の無いモデルクラスがあっても検査できる" do
    # db/seeds.rb が作る Class.new(ApplicationRecord) は descendants に残る。
    # spec の実行順は random なので、seed を読み込む spec が先に走った回だけ
    # 落ちる、という形の壊れ方をする。
    anonymous = Class.new(ApplicationRecord)
    expect(anonymous.name).to be_nil

    expect { validated_models }.not_to raise_error
    expect(validated_models).not_to include(anonymous)
  end

  it "同じファイルで定義した STI の子クラスも検査対象に含む" do
    # ファイル名との一致で絞ると、board.rb の中に書いた子クラスが検査から外れる。
    expect(application_model?(Board)).to be(true)

    subclass = Class.new(Board)
    stub_const("ArchivedBoardForSpec", subclass)

    # 定義位置はこの spec ファイルになるため対象外だが、名前の無いクラスとは違い
    # 判定が例外にならないことを確かめる。
    expect { application_model?(subclass) }.not_to raise_error
  end

  it "errors.add の第一引数だけを属性として扱う" do
    # 引数リストを越えてシンボルを探すと、動的な指定の第二引数を属性名と誤認する。
    # :base はレコード全体に対するエラーで属性ではないため、和名を要求してはいけない。
    source = <<~RUBY
      errors.add(:base, :some_error)
      errors.add(attribute, :blank)
      errors.add(:parent_frame_id, :invalid_parent_frame)
      errors.add :locked_by, :already_locked
      errors.add(:body, "plain text")
    RUBY

    expect(RubyTokenScanner.scan(source).errors_add_pairs).to eq(
      [ [ :parent_frame_id, :invalid_parent_frame ], [ :locked_by, :already_locked ], [ :body, nil ] ]
    )
  end

  it "errors.add で使うメッセージのシンボルがカタログにある" do
    # 属性名だけを検査していると、メッセージ側のシンボルが未定義でも緑になる。
    # config.i18n.raise_on_missing_translations を development/test で有効にしたため、
    # 未定義のシンボルは "Translation missing" という文字列ではなく
    # I18n::MissingTranslationData 例外として現れる（有効化前は前者だった）。
    # rescue せずに投げっぱなしにすると最初の1件で filter_map ごと中断し、
    # 残りの欠落が一覧に出ないまま検査が緑を報告する。
    offenders = validated_models.flat_map do |model|
      errors_add_pairs(model).filter_map do |attribute, message|
        next if message.nil?

        record = model.new
        record.errors.add(attribute, message)

        begin
          rendered = record.errors.full_messages.first
          next unless rendered.include?("Translation missing")
        rescue I18n::MissingTranslationData
          # 上と同じ欠落を、例外として検出した場合。
        end

        "  #{model.name}##{attribute} => :#{message}"
      end
    end

    expect(offenders).to be_empty, <<~MESSAGE
      errors.add に渡しているメッセージのシンボルがカタログに無い。
      config/locales/ja.yml の activerecord.errors.models 以下に追加すること。

      #{offenders.join("\n")}
    MESSAGE
  end

  it "未定義のシンボルを例外としても取りこぼさない" do
    # raise_on_missing_translations 有効下では、未定義のシンボルは
    # "Translation missing" という文字列ではなく I18n::MissingTranslationData として
    # 現れる。上のテストが rescue を外すとこのケースを静かに見逃す（＝全体が例外で落ちて
    # 他の欠落が一覧に出なくなる）ため、検出ロジックそのものをここで固定する。
    record = Comment.new
    record.errors.add(:body, :totally_missing_key_for_locale_catalog_spec)

    detected = begin
      rendered = record.errors.full_messages.first
      rendered.include?("Translation missing")
    rescue I18n::MissingTranslationData
      true
    end

    expect(detected).to be(true)
  end

  it "errors.add の引数にコメントがあっても読み取れる" do
    # コメントをトークン列に残したまま索引で辿ると、引数の途中に説明を書いただけで
    # メッセージが消えたり、呼び出しごと見えなくなったりする。このコードベースは
    # 検証の直上や引数の脇に日本語の説明を置く書き方が主流なので、その形で固定する。
    source = <<~RUBY
      errors.add(:parent_frame_id, # 同じボード上のフレームではない
        :invalid_parent_frame)
      errors.add(
        # 別の利用者が編集している
        :locked_by,
        :already_locked
      )
    RUBY

    expect(RubyTokenScanner.scan(source).errors_add_pairs).to eq(
      [ [ :parent_frame_id, :invalid_parent_frame ], [ :locked_by, :already_locked ] ]
    )
  end

  it "規約どおりの場所に無い concern も走査対象に含む" do
    # モジュールの置き場所を名前から推測すると、app/models/concerns/<名前>.rb 以外に
    # 置いた検証モジュールが検査から外れる。そこで errors.add した属性は和名が無くても
    # 報告されず、利用者は「Deleted atを入力してください」のような文言を見ることになる。
    model = Class.new(Board) { include LocaleCatalogSpecValidations }

    expect(model_source_paths(model).map(&:to_s)).to include(__FILE__)
  end

  it "バリデータクラスの errors.add も走査対象に含む" do
    # ancestors はモジュールしか辿らない。app/validators に切り出した検証は Class であり、
    # モデルの定義ファイルにも無いため、そこで errors.add したメッセージのシンボルが
    # カタログに無くても検査を通ってしまう。本番では 422 の本文に
    # "Translation missing. Options considered were: …" と内部のキーパスが並ぶ。
    model = Class.new(Board) { validates :title, locale_catalog_spec: true }

    expect(model_source_paths(model).map(&:to_s)).to include(__FILE__)
  end

  it "gem が提供するモジュールまで走査しない" do
    # 祖先には ActiveModel などのモジュールも並ぶ。これらまで読むと、走査の目的
    # （このリポジトリで書いた errors.add を集める）から外れ、無関係な失敗を招く。
    expect(model_source_paths(BoardObject)).to all(satisfy { |path| path.to_s.start_with?(BackendSourceTree.root.to_s) })
  end

  it "errors.add でしか使われない属性も検査対象に含めている" do
    # validators だけを見ていると、この属性は検査から漏れる。走査が空振りしていないことを
    # 実物で固定する。
    expect(BoardObject.validators.flat_map(&:attributes)).not_to include(:parent_frame_id)
    expect(errors_add_attributes(BoardObject)).to include(:parent_frame_id)
    expect(validated_attributes(BoardObject)).to include(:parent_frame_id)
  end

  it "ja.yml に書いたキーがすべて解決できる" do
    # rails-i18n が供給するキーだけを検査していると、アプリが自分で足したキーの
    # 打ち間違いや、そもそも ja.yml が読み込まれていない状態を検出できない。
    catalog = YAML.load_file(BackendSourceTree.root.join("config/locales/ja.yml")).fetch("ja")

    unresolved = leaf_keys(catalog).reject do |key|
      translation(key, count: 1, attribute: "属性", message: "メッセージ", record: "レコード", model: "モデル", errors: "エラー", remainingMinutes: 1, remainingSeconds: 1) != missing_sentinel
    end

    expect(unresolved).to be_empty, <<~MESSAGE
      ja.yml に書いてあるのに I18n から引けないキーがある。
      available_locales の設定漏れや、読み込み対象から外れている可能性がある。

      #{unresolved.join("
")}
    MESSAGE
  end

  it "利用可能なロケールが :ja だけになっている" do
    # rails-i18n は 123 言語分のカタログを同梱しており、絞らなければ全部が
    # 読み込まれる。それ自体の実害より、:ja 以外が「引ける」状態だと、
    # 日本語のみ（CLAUDE.md）という前提の上に立っている以下の検査が
    # すべて意味を失う点が問題になる。
    expect(I18n.available_locales).to eq([ :ja ])
    expect(I18n.default_locale).to eq(:ja)
  end

  it "翻訳キーを持つロケールファイルが ja.yml だけになっている" do
    # available_locales が [:ja] のため、:ja 以外のファイルは読み込み対象には
    # 残るが、中身はすべて捨てられる。例外にも警告にもならないので、そこに
    # 文言を足した人は何の反応も得られないまま、その文言が出ないことに気付けない。
    #
    # 「書いても効かない置き場」を木に残さないために、キーを持つファイルを
    # ja.yml に限る。翻訳を増やす場合は available_locales の変更（＝多言語対応を
    # 行わないという方針の変更）とセットになるはずで、そのときここが赤くなる。
    locale_paths = BackendSourceTree.root.join("config/locales").glob("*.{yml,yaml}").sort

    offenders = locale_paths.filter_map do |path|
      next if path.basename.to_s == "ja.yml"

      keys = translation_keys(YAML.load_file(path))
      next if keys.empty?

      "  #{BackendSourceTree.relative(path)} => #{keys.sort.join(', ')}"
    end

    # 走査が空振りしていれば違反ゼロは「無かった」ではなく「見ていない」を意味する。
    expect(locale_paths.map { |path| path.basename.to_s }).to include("ja.yml")

    expect(offenders).to be_empty, <<~MESSAGE
      available_locales に含まれないロケールのファイルに翻訳キーが書いてある。
      これらは読み込まれても捨てられるため、書いても利用者には出ない。
      文言は config/locales/ja.yml に置くこと。

      #{offenders.join("\n")}
    MESSAGE
  end

  it "値の無いキーは文言が置かれているとみなさない" do
    # en.yml が "en:" だけを残せているのはこの緩さのおかげだが、緩めた分だけ
    # 検査の穴になる。値が入った途端に葉として数えることを実物で固定する。
    expect(translation_keys(YAML.load_file(BackendSourceTree.root.join("config/locales/en.yml")))).to be_empty
    expect(translation_keys({ "en" => nil })).to be_empty
    expect(translation_keys({ "en" => { "hello" => "Hello world" } })).to eq([ "en.hello" ])
  end

  it "コードが参照している I18n のキーがカタログにある" do
    # ja.yml 側から「書いたキーが引けるか」を見るだけでは、コードが引くキーの
    # 打ち間違いや書き忘れは分からない。その向きの欠落は例外にならず
    # "Translation missing: ja.…" という文字列として応答本文に載る。
    #
    # config.i18n.raise_on_missing_translations は開発とテストで有効にしたが、
    # それが効くのは実際にその行を通る例がある場合だけ。まだ経路の無いキーは
    # ここで直接検査する。
    referenced = BackendSourceTree.ruby_paths("app").flat_map do |path|
      RubyTokenScanner.scan(path.read).i18n_keys.map { |key| [ BackendSourceTree.relative(path).to_s, key ] }
    end

    # 走査が空振りしていれば、違反ゼロは「無かった」ではなく「見ていない」を意味する。
    expect(referenced.map(&:last)).to include("api.errors.invalid_comment_body")

    missing = referenced.select do |_file, key|
      !I18n.exists?(key)
    end

    expect(missing).to be_empty, <<~MESSAGE
      コードが I18n.t で参照しているキーがカタログに無い。
      config/locales/ja.yml に追加すること。

      #{missing.map { |file, key| "  #{file}: #{key}" }.join("\n")}
    MESSAGE
  end

  it "アプリ固有の文言が日本語で解決できる" do
    # モデルのカスタムバリデーションが参照するキー。ここが欠けると
    # "Translation missing: ja.…" がそのまま API のエラー本文に出る。
    board_object = BoardObject.new
    board_object.errors.add(:parent_frame_id, :invalid_parent_frame)

    expect(board_object.errors.full_messages.first).to eq("親フレームは同じボード上の有効なフレームを指定してください")
  end

  it "検査対象のモデルを実際に読んでいる" do
    # 走査が空振りしていれば、違反ゼロという結果は「無かった」ではなく「見ていない」を意味する。
    names = validated_models.map(&:name)

    expect(names).to include("Comment", "Board", "BoardObject")
  end
end
