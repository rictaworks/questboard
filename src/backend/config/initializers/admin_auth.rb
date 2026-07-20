# Validate admin basic authentication credentials on startup
if Rails.env.test?
  ENV["ADMIN_BASIC_AUTH_USERNAME"] ||= "admin"
  ENV["ADMIN_BASIC_AUTH_PASSWORD"] ||= "secret"
end

admin_username = ENV["ADMIN_BASIC_AUTH_USERNAME"].to_s.strip
admin_password = ENV["ADMIN_BASIC_AUTH_PASSWORD"].to_s.strip

if admin_username.empty? || admin_password.empty?
  raise StandardError, "ADMIN_BASIC_AUTH_USERNAME and ADMIN_BASIC_AUTH_PASSWORD must be present and non-empty."
end
