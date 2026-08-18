allowed_origins = if Rails.env.production?
  origins = ENV.fetch("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map(&:strip)
    .reject(&:empty?)

  raise ArgumentError, "CORS_ALLOWED_ORIGINS must not be empty" if origins.empty?

  origins
else
  # 本番は起動時に一度だけ配列を確定させればよいが（Vercel/Railwayのドメインは
  # 固定）、開発はCodespacesの転送URLをリクエストごとに判定する必要がある
  # （DevelopmentAllowedOrigins参照）。Rack::Cors は Proc を渡すとリクエストごとに
  # 呼び出すため、ここを固定配列にせずProcにすることで、
  # RequestOriginGuard（app/controllers/concerns）と判定基準を一致させる。
  [ ->(source, _env) { DevelopmentAllowedOrigins.allowed?(source) } ]
end

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*allowed_origins)
    resource "*", headers: :any, methods: %i[get head options post patch delete], credentials: true
  end
end
