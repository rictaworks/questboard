class ApplicationController < ActionController::API
  include ActionController::Cookies
  include ActionController::HttpAuthentication::Basic::ControllerMethods

  before_action :verify_request_safety!

  private

  def current_user
    @current_user ||= User.find_by(id: session[:user_id]) if session[:user_id].present?
  end

  def verify_request_safety!
    return if request.get? || request.head? || request.options?

    verify_origin!
    return if performed?

    verify_content_type!
  end

  def verify_origin!
    origin = request.headers["Origin"].presence || request.headers["HTTP_ORIGIN"].presence
    return unless origin.present?

    unless allowed_origins.include?(origin)
      render json: { error: "Forbidden origin" }, status: :forbidden
    end
  end

  FORBIDDEN_CSRF_MEDIA_TYPES = %w[
    application/x-www-form-urlencoded
    multipart/form-data
    text/plain
  ].freeze

  def verify_content_type!
    return unless request.post? || request.patch? || request.put?

    if FORBIDDEN_CSRF_MEDIA_TYPES.include?(request.media_type)
      render json: { error: "Content-Type must be application/json" }, status: :unsupported_media_type
    end
  end

  def allowed_origins
    @allowed_origins ||= if Rails.env.production?
      ENV.fetch("CORS_ALLOWED_ORIGINS", "").split(",").map(&:strip).reject(&:empty?)
    else
      [ "http://localhost:3000" ]
    end
  end
end
