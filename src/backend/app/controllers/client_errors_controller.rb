class ClientErrorsController < ApplicationController
  class CacheProxy
    def increment(*args, **kwargs)
      Rails.cache.increment(*args, **kwargs)
    end

    def write(*args, **kwargs)
      Rails.cache.write(*args, **kwargs)
    end
  end

  rate_limit to: 10, within: 1.minute, only: :create, by: -> { request.remote_ip }, store: CacheProxy.new

  MAX_MESSAGE_BYTES = 2_048
  MAX_STACK_BYTES = 8_192

  def create
    Rails.logger.error(error_payload.to_json)
    head :no_content
  end

  private

  def error_payload
    {
      event: "client_error",
      message: trimmed_string(params[:message], MAX_MESSAGE_BYTES),
      stack: trimmed_string(params[:stack], MAX_STACK_BYTES),
      source: trimmed_string(params[:source], MAX_MESSAGE_BYTES),
      url: sanitize_url(trimmed_string(params[:url], MAX_MESSAGE_BYTES)),
      line: numeric_value(params[:line]),
      column: numeric_value(params[:column]),
      user_agent: trimmed_string(params[:user_agent], MAX_MESSAGE_BYTES)
    }
  end

  def sanitize_url(url_str)
    return "" if url_str.blank?
    safe_url = url_str.to_s.scrub("")
    begin
      uri = URI.parse(safe_url)
      uri.query = nil
      uri.fragment = nil
      uri.path = uri.path.to_s.gsub(%r{(/b/)[^/]+}, '\1__redacted__')
      uri.to_s.gsub("__redacted__", "[redacted]")
    rescue URI::InvalidURIError, URI::InvalidComponentError
      base_url = safe_url.split(/[?#]/, 2).first
      base_url.gsub(%r{(/b/)[^/]+}, '\1[redacted]')
    end
  end

  def trimmed_string(value, limit)
    string = value.to_s
    string.byteslice(0, limit).scrub("")
  end

  def numeric_value(value)
    Integer(value)
  rescue ArgumentError, TypeError
    nil
  end
end
