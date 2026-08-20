# Content-Security-Policy を全応答に付ける（issue #240）。
#
# backend は nosniff・X-Frame-Options・Referrer-Policy を返していたが CSP だけ無かった。
# 応答の大半は JSON だが、/admin 配下は HTML を返すため CSP が意味を持つ。
#
# style-src に unsafe-inline を許すのは、管理画面のレイアウトとビューが
# <style> をテンプレートに直接埋めているため（app/views/layouts/admin.html.erb ほか）。
# nonce 方式にするには全ビューへ nonce 属性を配る必要があり、この変更の範囲を超える。
# 管理画面は Basic 認証の内側にあり、利用者入力由来の HTML を描画しないため、
# style に限った unsafe-inline は受け入れる。
#
# インラインの <script> は管理画面に存在しないことを確認済みなので、
# script-src は default-src の :none のままで塞ぐ。
Rails.application.configure do
  config.content_security_policy do |policy|
    policy.default_src :none
    policy.style_src :self, :unsafe_inline
    policy.img_src :self, :data
    policy.font_src :self
    policy.form_action :self
    policy.base_uri :none
    policy.frame_ancestors :none
  end
end
