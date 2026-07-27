class ClientErrorsController < ApplicationController
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
      url: trimmed_string(params[:url], MAX_MESSAGE_BYTES),
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
end
