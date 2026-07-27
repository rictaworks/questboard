require "uri"

module SentryEventSanitizer
  module_function

  SHARE_TOKEN_PATH = %r{/(b|boards)/[^/?#]+}

  def sanitize!(event)
    sanitize_request!(event)
    sanitize_transaction!(event)
    sanitize_breadcrumbs!(event)
    event
  end

  def sanitize_url(value)
    return "" if value.nil? || value.to_s.empty?

    safe_url = value.to_s.scrub("")
    begin
      uri = URI.parse(safe_url)
      uri.query = nil
      uri.fragment = nil
      uri.path = uri.path.to_s.gsub(SHARE_TOKEN_PATH, '/\1/[redacted]')
      uri.to_s
    rescue URI::InvalidURIError, URI::InvalidComponentError
      safe_url.split(/[?#]/, 2).first.to_s.gsub(SHARE_TOKEN_PATH, '/\1/[redacted]')
    end
  end

  def sanitize_request!(event)
    request = object_value(event, :request)
    return unless request

    set_object_value(request, :url, sanitize_url(object_value(request, :url)))
  end

  def sanitize_transaction!(event)
    transaction = object_value(event, :transaction)
    return unless transaction.is_a?(String)

    set_object_value(event, :transaction, sanitize_url(transaction))
  end

  def sanitize_breadcrumbs!(event)
    breadcrumbs = object_value(event, :breadcrumbs)
    return unless breadcrumbs.respond_to?(:each)

    breadcrumbs.each do |breadcrumb|
      data = object_value(breadcrumb, :data)
      next unless data

      set_object_value(breadcrumb, :url, sanitize_url(object_value(breadcrumb, :url))) if object_value(breadcrumb, :url).is_a?(String)
      set_object_value(data, :url, sanitize_url(object_value(data, :url)))
      set_object_value(breadcrumb, :message, sanitize_url(object_value(breadcrumb, :message))) if object_value(breadcrumb, :message).is_a?(String)
    end
  end

  def object_value(object, key)
    if object.respond_to?(key)
      object.public_send(key)
    elsif object.respond_to?(:[])
      object[key]
    end
  rescue NameError
    nil
  end

  def set_object_value(object, key, value)
    setter = "#{key}="
    if object.respond_to?(setter)
      object.public_send(setter, value)
    elsif object.respond_to?(:[])
      object[key] = value
    end
  rescue NameError
    nil
  end
end
