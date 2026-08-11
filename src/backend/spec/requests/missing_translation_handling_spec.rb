require "rails_helper"

# config.i18n.raise_on_missing_translations は development/test/production のすべてで
# true にしてある（config/environments/*.rb 参照）。未定義キー参照を「サイレントに
# "Translation missing: ja.…" という文字列へ落とす」のではなく、確実に例外として検出する
# ための設定であり、その例外を ApplicationController#render_missing_translation が
# 構造化 JSON の 500 応答に変換していることをここで確認する。
#
# アプリの実在キーはすべて locale_catalog_spec.rb が網羅性を検査済みのため、実際のリクエスト
# 経路で未定義キーを自然には再現できない。そのため、意図的に未定義キーを参照するだけの
# コントローラを一時的なルーティングに載せて検証する。
RSpec.describe "未定義の翻訳キーの扱い", type: :request do
  # ApplicationController のみを継承し、認可・認証の前提を持ち込まない最小のコントローラ。
  # 実在しないキーを I18n.t(..., raise: true) で参照して I18n::MissingTranslationData を
  # 意図的に発生させる。
  let(:controller_class) do
    Class.new(ApplicationController) do
      def index
        I18n.t("spec.intentionally_missing_translation_key_for_test", raise: true)
      end
    end
  end

  around do |example|
    stub_const("MissingTranslationTestController", controller_class)
    Rails.application.routes.draw do
      get "/__spec/missing_translation_test", to: "missing_translation_test#index"
    end

    example.run
  ensure
    Rails.application.reload_routes!
  end

  it "logs the missing key but does not leak it, and returns the shared 500 message" do
    allow(Rails.logger).to receive(:error)

    get "/__spec/missing_translation_test"

    expect(response).to have_http_status(:internal_server_error)
    expect(JSON.parse(response.body)).to eq("error" => "サーバーエラーが発生しました")
    expect(Rails.logger).to have_received(:error).with(/intentionally_missing_translation_key_for_test/)
  end
end
