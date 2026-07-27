class RequestBodySizeLimiter
  MAX_BODY_SIZE = 64 * 1024 # 64KB
  MAX_CLIENT_ERROR_BODY_SIZE = 24 * 1024 # 24KB

  def initialize(app)
    @app = app
  end

  def call(env)
    request_method = env["REQUEST_METHOD"]
    request_path = env["PATH_INFO"]
    normalized_path = request_path.to_s.chomp("/")

    if request_method == "POST"
      limit = nil
      if normalized_path.match?(%r{\A/kpi_events(?:\.[a-zA-Z0-9]+)?\z})
        limit = MAX_BODY_SIZE
      elsif normalized_path.match?(%r{\A/client_errors(?:\.[a-zA-Z0-9]+)?\z})
        limit = MAX_CLIENT_ERROR_BODY_SIZE
      end

      if limit
        # Content-Length header early check
        content_length = env["CONTENT_LENGTH"]&.to_i
        if content_length && content_length > limit
          return [ 422, { "Content-Type" => "application/json" }, [ { error: "Request body size exceeds limit" }.to_json ] ]
        end

        # Stream size verification for chunked or missing Content-Length headers
        if env["rack.input"]
          input = env["rack.input"]
          body = input.read(limit + 1)
          if body && body.bytesize > limit
            return [ 422, { "Content-Type" => "application/json" }, [ { error: "Request body size exceeds limit" }.to_json ] ]
          end
          input.rewind if input.respond_to?(:rewind)
        end
      end
    end

    @app.call(env)
  end
end
