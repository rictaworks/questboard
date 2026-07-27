# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc,
  ->(key, value) do
    if key.to_s == "url" && value.is_a?(String)
      safe_val = value.scrub("")
      begin
        uri = URI.parse(safe_val)
        uri.query = nil
        uri.fragment = nil
        uri.path = uri.path.to_s.gsub(%r{(/b/)[^/]+}, '\1__redacted__')
        value.replace(uri.to_s.gsub("__redacted__", "[redacted]"))
      rescue URI::InvalidURIError, URI::InvalidComponentError
        value.replace(safe_val.split(/[?#]/, 2).first.to_s.gsub(%r{(/b/)[^/]+}, '\1[redacted]'))
      end
    end
  end
]
