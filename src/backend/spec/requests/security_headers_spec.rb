require "rails_helper"

# issue #240: backend は nosniff・X-Frame-Options・Referrer-Policy を返していたが
# CSP だけ無かった。設定したことと、実際に応答に載ることは別なので応答で確かめる。
RSpec.describe "セキュリティヘッダ", type: :request do
  it "JSON 応答に CSP が付く" do
    get "/healthz"

    expect(response).to have_http_status(:ok)
    expect(response.headers["Content-Security-Policy"]).to be_present
  end

  it "既定を塞ぎ、フレーム埋め込みを禁じている" do
    get "/healthz"

    policy = response.headers["Content-Security-Policy"]

    expect(policy).to include("default-src 'none'")
    expect(policy).to include("frame-ancestors 'none'")
  end

  # 管理画面はテンプレートに <style> を直接書いているため、ここを塞ぐと
  # 画面が素の HTML になる。許可されていることを固定する
  it "管理画面のためにインラインスタイルを許可している" do
    get "/healthz"

    policy = response.headers["Content-Security-Policy"]

    expect(policy).to match(/style-src[^;]*'unsafe-inline'/)
  end

  # インラインスクリプトは管理画面に存在しない。将来足したくなったときに
  # このテストが落ちて、nonce を配る判断を迫られるようにしておく
  it "インラインスクリプトは許可していない" do
    get "/healthz"

    policy = response.headers["Content-Security-Policy"]

    expect(policy).not_to match(/script-src[^;]*'unsafe-inline'/)
  end
end
