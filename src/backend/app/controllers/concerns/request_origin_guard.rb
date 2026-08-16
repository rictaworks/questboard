module RequestOriginGuard
  extend ActiveSupport::Concern

  FORBIDDEN_CSRF_MEDIA_TYPES = %w[
    application/x-www-form-urlencoded
    multipart/form-data
    text/plain
  ].freeze

  included do
    before_action :verify_request_safety!
  end

  private

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
      render json: { error: I18n.t("api.errors.forbidden_origin") }, status: :forbidden
    end
  end

  def verify_content_type!
    # 呼び出し元の verify_request_safety! が GET/HEAD/OPTIONS を既に除外しているため、
    # ここに到達するのは状態変更系メソッドのみ。DELETEを判定条件から外していた過去の実装は、
    # 素のHTTP DELETEがHTMLフォームから送信不可能（ブラウザ標準機能では発行できない）だった
    # ことを暗黙の前提にしていたが、config/application.rb で Rack::MethodOverride を
    # 追加した（issue #181対応）ことで、application/x-www-form-urlencoded の
    # POST + _method=delete という verb tunneling でDELETE相当のリクエストを
    # CORSプリフライト無しに送信できるようになった。DELETEもこのCSRF対策の対象に含める。
    return if request.get? || request.head? || request.options?

    if FORBIDDEN_CSRF_MEDIA_TYPES.include?(request.media_type)
      render json: { error: I18n.t("api.errors.content_type_must_be_json") }, status: :unsupported_media_type
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
