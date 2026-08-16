require "rails_helper"

RSpec.describe "RequestOriginGuard", type: :request do
  # config/application.rb で Rack::MethodOverride をアプリ全体のミドルウェアスタックに
  # 追加した（issue #181, admin/usersのtoggle_bypassボタン対応）。このミドルウェアは
  # POSTリクエストのボディ中の _method パラメータを読んでHTTPメソッドを読み替えるため、
  # ブラウザのHTMLフォーム（application/x-www-form-urlencoded、CORSプリフライト対象外）
  # から DELETE/PATCH/PUT 相当のリクエストを偽装できるようになる。
  #
  # RequestOriginGuard#verify_content_type! はCSRF対策として
  # application/x-www-form-urlencoded 等のフォーム形式コンテンツタイプでの
  # POST/PATCH/PUTを拒否するが、判定対象がRack::MethodOverride適用後（読み替え後）の
  # HTTPメソッドであるため、DELETEへの読み替えだけは判定条件から漏れており、
  # verb tunnelingで素通りしてしまう。
  it "rejects a method-overridden DELETE request that uses a forbidden CSRF content type" do
    post "/boards/some-token",
      params: { _method: "delete" },
      headers: { "CONTENT_TYPE" => "application/x-www-form-urlencoded" }

    expect(response).to have_http_status(:unsupported_media_type)
  end
end
