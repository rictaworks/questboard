require "time"

class KpiEventsController < ApplicationController
  class KpiEventValidationError < StandardError; end

  before_action :require_current_user!
  rate_limit to: 100, within: 1.minute, only: :create, by: -> { "user:#{current_user&.id}" }

  ALLOWED_CLIENT_EVENTS = {
    "radial_opened" => {
      required: %w[source],
      types: { "source" => String },
      max_lengths: { "source" => 30 }
    },
    "camera_panned" => {
      required: %w[source],
      types: { "source" => String },
      max_lengths: { "source" => 30 }
    },
    "camera_zoomed" => {
      required: %w[source zoom],
      types: { "source" => String, "zoom" => Numeric },
      max_lengths: { "source" => 30 }
    },
    "intensity_changed" => {
      required: %w[intensity],
      types: { "intensity" => String },
      max_lengths: { "intensity" => 10 },
      inclusion: { "intensity" => %w[full subtle off] }
    }
  }.freeze

  MAX_REQUEST_SIZE = 64 * 1024 # 64KB



  def create
    validate_request_size!

    events = normalized_events
    persisted = []

    KpiEvent.transaction do
      events.each do |event|
        persisted << persist_event!(event)
      end
    end

    render json: { accepted: persisted.length }, status: :created
  end

  private

  def require_current_user!
    head :unauthorized unless current_user
  end

  def validate_request_size!
    size = request.content_length.to_i
    if size > MAX_REQUEST_SIZE
      raise KpiEventValidationError, "Request body size exceeds limit of #{MAX_REQUEST_SIZE} bytes"
    end
  end

  def normalized_events
    raw_events = params.require(:events)
    raise KpiEventValidationError, "events must be an array" unless raw_events.is_a?(Array)
    raise KpiEventValidationError, "batch size exceeds limit of 20" if raw_events.length > 20

    raw_events.map do |event|
      permitted = event.respond_to?(:permit) ? event.permit(:eventId, :boardId, :userId, :timestamp, attributes: {}) : event
      event_hash = permitted.to_h

      event_id = parse_event_id!(event_hash["eventId"])

      {
        attributes: validate_attributes!(event_id, event_hash["attributes"] || {}),
        board_id: parse_board_id!(event_hash["boardId"]),
        event_id: event_id,
        timestamp: parse_timestamp!(event_hash["timestamp"]),
        user_id: parse_user_id!(event_hash["userId"])
      }
    end
  end

  def persist_event!(event)
    board = Board.find_by(id: event.fetch(:board_id)) || raise(ApplicationController::BoardNotFoundError)
    board.board_members.includes(:role).find_by(user: current_user) || raise(ApplicationController::BoardNotFoundError)

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
    raise KpiEventValidationError, "Direct submission of event #{event_id} is not allowed" unless ALLOWED_CLIENT_EVENTS.key?(event_id)

    event_id
  end

  def parse_user_id!(value)
    user_id = value.to_s
    raise KpiEventValidationError, "userId is required" if user_id.blank?
    raise KpiEventValidationError, "userId must match the active X user ID" if user_id != current_user.x_user_id

    user_id
  end

  def parse_timestamp!(value)
    t = Time.iso8601(value.to_s)
    # 未来方向は5分後まで許容し、それを超える未来は現在時刻に正規化
    if t > Time.current + 5.minutes
      t = Time.current
    end
    # 過去方向は30日前まで許容し、それを超える過去は現在時刻に正規化
    if t < 30.days.ago
      t = Time.current
    end
    t
  rescue ArgumentError, TypeError
    raise KpiEventValidationError, "timestamp is invalid"
  end

  def validate_attributes!(event_id, attributes)
    raise KpiEventValidationError, "attributes must be an object" unless attributes.is_a?(Hash) || attributes.respond_to?(:to_unsafe_h)

    attributes = attributes.to_unsafe_h if attributes.respond_to?(:to_unsafe_h)
    attributes = attributes.to_h if attributes.is_a?(Hash)
    raise KpiEventValidationError, "attributes must be an object" unless attributes.is_a?(Hash)

    rules = ALLOWED_CLIENT_EVENTS[event_id]
    raise KpiEventValidationError, "Direct submission of event #{event_id} is not allowed" unless rules

    # 未知のキーをすべて拒否 (PII回避防止)
    unknown_keys = attributes.keys.map(&:to_s) - rules[:types].keys
    raise KpiEventValidationError, "Unknown attributes are not allowed" if unknown_keys.any?

    # 必須キーの存在チェック
    rules[:required].each do |req|
      raise KpiEventValidationError, "Missing required attribute: #{req}" unless attributes.key?(req) || attributes.key?(req.to_sym)
    end

    # 型と長さのチェック
    attributes.each do |key, value|
      key_str = key.to_s
      expected_type = rules[:types][key_str]
      if expected_type == Numeric
        unless value.is_a?(Numeric)
          raise KpiEventValidationError, "Attribute #{key} must be Numeric, got #{value.class}"
        end
      elsif expected_type == String
        unless value.is_a?(String)
          raise KpiEventValidationError, "Attribute #{key} must be String, got #{value.class}"
        end

        max_len = rules[:max_lengths][key_str]
        if max_len && value.bytesize > max_len
          raise KpiEventValidationError, "Attribute #{key} exceeds maximum length of #{max_len} bytes"
        end
      end
    end

    # inclusion (値の制限) のチェック
    if rules[:inclusion]
      rules[:inclusion].each do |attr_name, allowed_values|
        val = attributes[attr_name] || attributes[attr_name.to_sym]
        if val && !allowed_values.include?(val)
          raise KpiEventValidationError, "Attribute #{attr_name} has invalid value: #{val}"
        end
      end
    end

    reject_pii!(attributes)
    attributes
  end

  def reject_pii!(value, path = [])
    case value
    when Array
      value.each_with_index { |entry, index| reject_pii!(entry, path + [ index.to_s ]) }
    when Hash
      value.each do |key, entry|
        key_path = path + [ key.to_s ]
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
