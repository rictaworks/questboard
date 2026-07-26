class RequestBodySizeLimiter
  MAX_BODY_SIZE = 64 * 1024 # 64KB

  def initialize(app)
    @app = app
  end

  def call(env)
    request_method = env["REQUEST_METHOD"]
    request_path = env["PATH_INFO"]
    normalized_path = request_path.to_s.chomp("/")

    if request_method == "POST" && normalized_path == "/kpi_events"
      # Content-Length header early check
      content_length = env["CONTENT_LENGTH"]&.to_i
      if content_length && content_length > MAX_BODY_SIZE
        return [ 422, { "Content-Type" => "application/json" }, [ { error: "Request body size exceeds limit" }.to_json ] ]
      end

      # Stream size verification for chunked or missing Content-Length headers
      if env["rack.input"]
        input = env["rack.input"]
        body = input.read(MAX_BODY_SIZE + 1)
        if body && body.bytesize > MAX_BODY_SIZE
          return [ 422, { "Content-Type" => "application/json" }, [ { error: "Request body size exceeds limit" }.to_json ] ]
        end
        input.rewind if input.respond_to?(:rewind)
      end
    end

    @app.call(env)
  end
end
