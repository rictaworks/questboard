require "time"

class KpiEventsController < ApplicationController
  class KpiEventValidationError < StandardError; end

  before_action :require_current_user!

  def create
    events = normalized_events
    persisted = []

    KpiEvent.transaction do
      events.each do |event|
        persisted << persist_event!(event)
      end
    end

    render json: { accepted: persisted.length }, status: :created
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue KpiEventValidationError => e
    logger.warn("[KpiEventsController#create] #{e.message}")
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Board not found" }, status: :not_found
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  def normalized_events
    raw_events = params.require(:events)
    raise KpiEventValidationError, "events must be an array" unless raw_events.is_a?(Array)

    raw_events.map do |event|
      permitted = event.respond_to?(:permit) ? event.permit(:eventId, :boardId, :userId, :timestamp, attributes: {}) : event
      event_hash = permitted.to_h

      {
        attributes: validate_attributes!(event_hash["attributes"] || {}),
        board_id: parse_board_id!(event_hash["boardId"]),
        event_id: parse_event_id!(event_hash["eventId"]),
        timestamp: parse_timestamp!(event_hash["timestamp"]),
        user_id: parse_user_id!(event_hash["userId"])
      }
    end
  end

  def persist_event!(event)
    board = Board.find(event.fetch(:board_id))
    board.member_for!(current_user)

    event_def = EventDef.find_by(code: event.fetch(:event_id))
    raise KpiEventValidationError, "Unsupported KPI event: #{event.fetch(:event_id)}" unless event_def

    KpiEvent.create!(
      board:,
      event_def:,
      occurred_at: event.fetch(:timestamp),
      props: event.fetch(:attributes),
      user: current_user
    )
  end

  def parse_board_id!(value)
    Integer(value)
  rescue ArgumentError, TypeError
    raise KpiEventValidationError, "boardId must be an integer"
  end

  def parse_event_id!(value)
    event_id = value.to_s
    raise KpiEventValidationError, "eventId is required" if event_id.blank?

    event_id
  end

  def parse_user_id!(value)
    user_id = value.to_s
    raise KpiEventValidationError, "userId is required" if user_id.blank?
    raise KpiEventValidationError, "userId must match the active Google sub" if user_id != current_user.google_sub

    user_id
  end

  def parse_timestamp!(value)
    Time.iso8601(value.to_s)
  rescue ArgumentError, TypeError
    raise KpiEventValidationError, "timestamp is invalid"
  end

  def validate_attributes!(attributes)
    raise KpiEventValidationError, "attributes must be an object" unless attributes.is_a?(Hash) || attributes.respond_to?(:to_unsafe_h)

    attributes = attributes.to_unsafe_h if attributes.respond_to?(:to_unsafe_h)
    attributes = attributes.to_h if attributes.is_a?(Hash)
    raise KpiEventValidationError, "attributes must be an object" unless attributes.is_a?(Hash)

    reject_pii!(attributes)
    attributes
  end

  def reject_pii!(value, path = [])
    case value
    when Array
      value.each_with_index { |entry, index| reject_pii!(entry, path + [index.to_s]) }
    when Hash
      value.each do |key, entry|
        key_path = path + [key.to_s]
        joined = key_path.join(".")

        if joined.match?(/(?:^|[_.-])(name|fullName|firstName|lastName|email|emailAddress|address|street|postalCode|zipCode|city|state|country|phone|phoneNumber|tel|telephone|mobile|dob|birth|birthday|dateOfBirth)(?:$|[_.-])/i)
          raise KpiEventValidationError, "PII-bearing attribute rejected at #{joined}"
        end

        reject_pii!(entry, key_path)
      end
    when String
      if value.match?(/(^|[\s<])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}($|[\s>.,;:!?])/) || value.match?(/^\+?[0-9()\-\s]{7,}$/)
        raise KpiEventValidationError, "PII-bearing attribute rejected at #{path.join(".")}"
      end
      if value.match?(/^\d{4}-\d{2}-\d{2}$/) && path.join(".").match?(/dob|birth/i)
        raise KpiEventValidationError, "PII-bearing attribute rejected at #{path.join(".")}"
      end
    end
  end
end
