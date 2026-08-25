require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
# require "active_storage/engine"
require "action_controller/railtie"
require "action_mailer/railtie"
# require "action_mailbox/engine"
# require "action_text/engine"
require "action_view/railtie"
require "action_cable/engine"
# require "rails/test_unit/railtie"

Bundler.require(*Rails.groups)

require_relative "../app/middleware/request_body_size_limiter"

module Backend
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1
    # 表示言語は日本語のみとし、多言語対応は行わない（CLAUDE.md の方針）。
    # available_locales を明示しないと rails-i18n は同梱する全ロケール（123言語・
    # 約290ファイル）を load_path に積む。使わないロケールを起動のたびに解析させない。
    config.i18n.default_locale = :ja
    config.i18n.available_locales = [ :ja ]

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true
    # セッションの有効期限（Issue #258）。
    #
    # **これが降格の担保である。** フォロワー判定を x-follower-gate へ委譲した後、
    # プラン値が落ちる経路はログイン時と手動再判定だけになった。手動再判定は
    # 利用不可画面にしか導線が無く、member の利用者は押さない。期限が無いと
    # セッションが続く限りログイン処理が走らず、アンフォローしても使い続けられる。
    #
    # 期限が切れれば次の来訪でログイン処理が走り、そこで判定を取り直す。
    # **降格の遅れの上限はこの値そのものである。** 利用者ごとの最終確認日時や
    # 定期的な取り直しの仕組みを別に置かない。2つ置くと、どちらが効いて
    # 降格したのかが読めなくなる。
    #
    # 初期化処理（config/initializers）はここより後に読まれるため、
    # 値の取得と検証をこの場で行う。
    session_expire_after_days = ENV.fetch("SESSION_EXPIRE_AFTER_DAYS", "7").to_s.strip
    unless session_expire_after_days.match?(/\A[1-9]\d*\z/)
      raise StandardError, "SESSION_EXPIRE_AFTER_DAYS must be a positive integer."
    end

    # 上位ドメイン（rictaworks.jp）を指定すると無関係なデモサイトにも cookie が送信される。
    # 必ず questboard.rictaworks.jp に限定すること。
    config.session_store :cookie_store,
      key: "_questboard_session",
      domain: Rails.env.production? ? "questboard.rictaworks.jp" : nil,
      same_site: :lax,
      secure: Rails.env.production?,
      expire_after: session_expire_after_days.to_i.days

    # config.api_only = true は Rack::MethodOverride も既定のスタックから除外する。
    # admin/users の button_to ..., method: :patch は実ブラウザでは method="post" の
    # HTMLフォーム + 隠しフィールド _method=patch として送信され、このミドルウェアが
    # 無いと PATCH にリライトされずルーティングエラーになる（issue #181）。
    config.middleware.use Rack::MethodOverride
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use ActionDispatch::Session::CookieStore, config.session_options
    config.middleware.use ActionDispatch::Flash
    # config.api_only = true は CSP のミドルウェアも既定スタックから除外する。
    # config/initializers/content_security_policy.rb で方針を定義しても、
    # これが無いと応答にヘッダが載らない（issue #240）
    config.middleware.use ActionDispatch::ContentSecurityPolicy::Middleware
    config.middleware.insert_before ActionDispatch::Cookies, RequestBodySizeLimiter
  end
end
