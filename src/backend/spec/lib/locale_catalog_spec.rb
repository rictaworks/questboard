require "rails_helper"
require "ripper"
require_relative "../support/backend_source_tree"
require_relative "../support/japanese_text"

# 表示言語は日本語のみ（CLAUDE.md）。default_locale は :ja で、production の
# config.i18n.fallbacks は I18n.default_locale へ落とす設定なので、:ja のフォールバック先は
# :ja 自身になる。つまり :ja に無いキーは英語に落ちるのではなく
# "Translation missing: ja.…" という文字列になり、そのまま API のエラー本文や
# 例外メッセージ（＝ログ）に出る。
#
# 個別の request spec は「その経路で使われるキー」しか踏まないため、まだ使っていない
# バリデーションのキーが欠けていても緑のまま通る。欠落は本番で初めて表面化する。
# そのため、カタログ側の網羅性をここで直接検査する。
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

  def validated_models
    Rails.application.eager_load!
    ActiveRecord::Base.descendants
      .reject(&:abstract_class?)
      .select(&:table_exists?)
      .sort_by(&:name)
  end

  # model.validators に現れるのは validates で宣言した属性だけで、カスタムの validate
  # メソッドの中で errors.add している属性は含まれない。そこだけ和名が無いと
  # 「Deleted atを入力してください」のような半英語の文言が緑のまま出荷される。
  # 宣言からは辿れないため、モデルのソースから errors.add の第一引数を拾う。
  def errors_add_attributes(model)
    path = BackendSourceTree.root.join("app/models/#{model.name.underscore}.rb")
    return [] unless path.file?

    tokens = Ripper.lex(path.read)
    tokens.each_with_index.filter_map do |(_position, type, token, _state), index|
      next unless type == :on_ident && token == "errors"

      following = tokens[(index + 1)..].reject { |(_p, kind, _v, _s)| kind == :on_sp }
      next unless following[0]&.at(2) == "." && following[1]&.at(2) == "add"
      # errors.add(:attribute, …) の :attribute を取り出す。
      symbol_index = following.index { |(_p, kind, _v, _s)| kind == :on_symbeg }
      next if symbol_index.nil?

      following[symbol_index + 1]&.at(2)&.to_sym
    end.uniq
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
      translation(key, count: 1, attribute: "属性", message: "メッセージ", record: "レコード", model: "モデル", errors: "エラー") != missing_sentinel
    end

    expect(unresolved).to be_empty, <<~MESSAGE
      ja.yml に書いてあるのに I18n から引けないキーがある。
      available_locales の設定漏れや、読み込み対象から外れている可能性がある。

      #{unresolved.join("
")}
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
