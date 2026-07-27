class RequestBodySizeLimiter
  MAX_BODY_SIZES = {
    "/client_errors" => 20 * 1024,
    "/kpi_events" => 64 * 1024
  }.freeze

  def initialize(app)
    @app = app
  end

  def call(env)
    request_method = env["REQUEST_METHOD"]
    request_path = env["PATH_INFO"]
    normalized_path = request_path.to_s.chomp("/")
    max_body_size = MAX_BODY_SIZES[normalized_path]

    if request_method == "POST" && max_body_size
      # Content-Length header early check
      content_length = env["CONTENT_LENGTH"]&.to_i
      if content_length && content_length > max_body_size
        return [ 422, { "Content-Type" => "application/json" }, [ { error: "Request body size exceeds limit" }.to_json ] ]
      end

      # Stream size verification for chunked or missing Content-Length headers
      if env["rack.input"]
        input = env["rack.input"]
        body = input.read(max_body_size + 1)
        if body && body.bytesize > max_body_size
          return [ 422, { "Content-Type" => "application/json" }, [ { error: "Request body size exceeds limit" }.to_json ] ]
        end
        input.rewind if input.respond_to?(:rewind)
      end
    end

    @app.call(env)
  end
end
