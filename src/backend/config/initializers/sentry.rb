require "sentry-ruby"
require "sentry-rails"
require Rails.root.join("lib/error_tracking").to_s

if ErrorTracking.sentry_enabled?
  Sentry.init do |config|
    config.dsn = ENV.fetch("SENTRY_DSN")
    config.environment = Rails.env.to_s
    config.enabled = true
  end
end
