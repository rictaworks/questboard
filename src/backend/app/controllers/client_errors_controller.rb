require "uri"

class ClientErrorsController < ApplicationController
  MAX_MESSAGE_BYTES = 2_048
  MAX_STACK_BYTES = 8_192
  MAX_URL_BYTES = 2_048

  rate_limit to: 20, within: 1.minute, only: :create, by: -> { "ip:#{request.remote_ip}" }

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
      url: trimmed_string(sanitized_url(params[:url]), MAX_URL_BYTES),
      line: numeric_value(params[:line]),
      column: numeric_value(params[:column]),
      user_agent: trimmed_string(params[:user_agent], MAX_MESSAGE_BYTES)
    }
  end

  def trimmed_string(value, limit)
    string = value.to_s
    string.byteslice(0, limit)
  end

  def numeric_value(value)
    Integer(value)
  rescue ArgumentError, TypeError
    nil
  end

  def sanitized_url(value)
    url = value.to_s
    return "" if url.empty?

    parsed = URI.parse(url)
    parsed.query = nil
    parsed.fragment = nil
    parsed.path = redact_board_share_token(parsed.path)
    parsed.to_s
  rescue URI::InvalidURIError
    redact_board_share_token(url.split("?", 2).first.split("#", 2).first)
  end

  def redact_board_share_token(path)
    segments = path.split("/")
    index = segments.index("b")
    return path unless index && segments[index + 1]

    segments[index + 1] = "[redacted]"
    segments.join("/")
  end
end
