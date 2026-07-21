allowed_origins = if Rails.env.production?
  origins = ENV.fetch("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map(&:strip)
    .reject(&:empty?)

  raise ArgumentError, "CORS_ALLOWED_ORIGINS must not be empty" if origins.empty?

  origins
else
  [ "http://localhost:3000" ]
end

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*allowed_origins)
    resource "*", headers: :any, methods: %i[get head options post delete], credentials: true
  end
end
