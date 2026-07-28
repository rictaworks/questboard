module ErrorTracking
  module_function

  def sentry_enabled?(env: Rails.env, dsn: ENV["SENTRY_DSN"])
    env.production? && !dsn.to_s.strip.empty?
  end
end
