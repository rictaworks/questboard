class ApplicationController < ActionController::API
  include ActionController::Cookies
  include ActionController::HttpAuthentication::Basic::ControllerMethods
  include RequestOriginGuard

  class ApiError < StandardError
    attr_reader :message_key, :status, :payload

    def initialize(message_key, status:, payload: {})
      super(message_key)
      @message_key = message_key
      @status = status
      @payload = payload
    end
  end

  class BoardNotFoundError < ApiError
    def initialize = super("api.errors.board_not_found", status: :not_found)
  end

  class BoardOrObjectNotFoundError < ApiError
    def initialize = super("api.errors.board_or_object_not_found", status: :not_found)
  end

  class BoardOrObjectTypeNotFoundError < ApiError
    def initialize = super("api.errors.board_or_object_type_not_found", status: :not_found)
  end

  class UnsupportedInviteRoleError < ApiError
    def initialize = super("api.errors.unsupported_invite_role", status: :unprocessable_content)
  end

  class CannotRemoveLastOwnerError < ApiError
    def initialize = super("api.errors.cannot_remove_the_last_owner", status: :unprocessable_content)
  end

  class CannotSkipQuestError < ApiError
    def initialize = super("api.errors.cannot_skip_quest", status: :unprocessable_content)
  end

  class CannotReopenQuestError < ApiError
    def initialize = super("api.errors.cannot_reopen_quest", status: :unprocessable_content)
  end

  class CannotClaimRewardError < ApiError
    def initialize = super("api.errors.cannot_claim_reward", status: :unprocessable_content)
  end

  class InvalidBoardTitleError < ApiError
    def initialize = super("api.errors.invalid_board_title", status: :unprocessable_content)
  end

  class InvalidCommentBodyError < ApiError
    def initialize = super("api.errors.invalid_comment_body", status: :unprocessable_content)
  end

  class InvalidIntensityError < ApiError
    def initialize = super("api.errors.invalid_intensity", status: :unprocessable_content)
  end

  class CommentCouldNotBeRecordedError < ApiError
    def initialize = super("api.errors.comment_could_not_be_recorded", status: :internal_server_error)
  end

  class RecaptchaVerificationFailedError < ApiError
    def initialize = super("api.errors.recaptcha_verification_failed", status: :unprocessable_content)
  end

  class GoogleOauthFailedError < ApiError
    def initialize = super("api.errors.google_oauth_failed", status: :bad_gateway)
  end

  class ObjectLockedByAnotherUserError < ApiError
    def initialize = super("api.errors.object_was_locked_by_another_user", status: :conflict)
  end

  # params.require はアプリ全体に散らばっており、アクションごとに rescue を書くと
  # 直し漏れがそのまま英語の応答として残る。ParameterMissing の文言は
  # "param is missing or the value is empty or invalid: <名前>" という形で、
  # 内部のパラメータ名を利用者に見せることにもなる。受け側で一度だけ扱う。
  rescue_from ActionController::ParameterMissing, with: :render_parameter_missing

  # production では config.i18n.raise_on_missing_translations が development/test と
  # 揃えて true になっている（config/environments/production.rb 参照）。フォールバックに
  # 頼らず失敗を明示する（CLAUDE.md「フォールバック処理は禁止。例外処理をしっかり書くこと」）
  # ための設定だが、rescue が無いと単に例外が生の 500 として素通しされ、フロントが
  # 期待する JSON ボディ（{ error: "..." }）が返らずレスポンスの解釈に失敗する。
  # ここで受けて、通常の500応答と同じ形に揃える。
  rescue_from I18n::MissingTranslationData, with: :render_missing_translation
  rescue_from ApiError, with: :render_api_error
  rescue_from ActiveRecord::RecordInvalid, with: :render_record_invalid
  rescue_from "BoardsController::InvalidBoardTitleError", with: :render_invalid_board_title
  rescue_from "CommentsController::InvalidCommentBodyError", with: :render_invalid_comment_body
  rescue_from "CommentsController::KpiEventConfigurationError", with: :render_comment_kpi_event_configuration
  rescue_from "KpiEventsController::KpiEventValidationError", with: :render_unprocessable_message
  rescue_from "ObjectsController::UnsupportedOpPropertyError", "ObjectsController::InvalidOpValueError",
              "ObjectsController::ImplausibleLamportJumpError", "ObjectsController::ReservedClientIdError",
              with: :render_unprocessable_message
  rescue_from "ObjectsController::StaleOpError", "ObjectsController::ConflictingOpError",
              "ObjectsController::DeletedObjectEditError", "ObjectsController::OutdatedReferenceError",
              with: :render_conflict_message
  rescue_from "UserSettingsController::InvalidIntensityError", with: :render_invalid_intensity
  rescue_from "Auth::RecaptchaVerifier::Error", with: :render_recaptcha_verification_failed
  rescue_from "Auth::GoogleOauthClient::Error", with: :render_google_oauth_failed
  rescue_from ObjectLockedByAnotherUserError, with: :render_api_error

  private

  def render_parameter_missing(error)
    # どのパラメータが欠けていたかは調査に要るため、応答ではなくログに残す。
    logger.warn("[#{self.class.name}##{action_name}] #{error.message}")

    render json: { error: I18n.t("api.errors.parameter_missing") }, status: :unprocessable_content
  end

  def render_missing_translation(error)
    # 欠けているキー名は調査に要るため、応答ではなくログに残す（キー名を利用者に見せない）。
    logger.error("[#{self.class.name}##{action_name}] #{error.message}")

    render json: { error: I18n.t("api.errors.internal_server_error") }, status: :internal_server_error
  end

  def render_api_error(error)
    render json: { error: I18n.t(error.message_key) }.merge(error.payload), status: error.status
  end

  def render_record_invalid(error)
    render json: { error: error.record.errors.full_messages.to_sentence }, status: :unprocessable_content
  end

  def render_invalid_board_title(error)
    log_invalid_input(error)

    render json: { error: I18n.t("api.errors.invalid_board_title") }, status: :unprocessable_content
  end

  def render_invalid_comment_body(error)
    log_invalid_input(error)

    render json: { error: I18n.t("api.errors.invalid_comment_body") }, status: :unprocessable_content
  end

  def render_invalid_intensity(error)
    log_invalid_input(error)

    render json: { error: I18n.t("api.errors.invalid_intensity") }, status: :unprocessable_content
  end

  def render_comment_kpi_event_configuration(error)
    logger.error("[#{self.class.name}##{action_name}] #{error.message}")

    render json: { error: I18n.t("api.errors.comment_could_not_be_recorded") }, status: :internal_server_error
  end

  def render_unprocessable_message(error)
    logger.warn("[#{self.class.name}##{action_name}] #{error.message}") if error.is_a?(KpiEventsController::KpiEventValidationError)

    render json: { error: error.message }, status: :unprocessable_content
  end

  def render_conflict_message(error)
    payload = { error: error.message }
    payload[:restoreSuggested] = true if error.is_a?(ObjectsController::DeletedObjectEditError)
    payload[:resyncRequired] = true if error.is_a?(ObjectsController::OutdatedReferenceError)

    render json: payload, status: :conflict
  end

  def render_recaptcha_verification_failed(error)
    logger.warn("[#{self.class.name}##{action_name}] #{error.message}")

    render json: { error: I18n.t("api.errors.recaptcha_verification_failed") }, status: :unprocessable_content
  end

  def render_google_oauth_failed(error)
    logger.error("[#{self.class.name}##{action_name}] #{error.message}")

    render json: { error: I18n.t("api.errors.google_oauth_failed") }, status: :bad_gateway
  end

  # 「型不正（空とは別の事象）」を検出したときにログへ残す定型処理。
  # BoardsController#normalized_board_title / CommentsController#normalized_comment_body が
  # それぞれ InvalidBoardTitleError / InvalidCommentBodyError を投げたときの rescue から呼ぶ。
  # 実際の型は調査に要るため応答ではなくログに残す。
  #
  # 応答文言（I18n.t の呼び出し）まではここに寄せない。文言のキーはフィールドごとに違うため
  # 集約する意味が薄いのに加え、`I18n.t("...")` という直接呼び出しの形を崩すと
  # spec/support/ruby_token_scanner.rb の「カタログ参照は直書き文言として数えない」判定が
  # 効かなくなり、キー文字列そのものが直書きの英語文言として誤検出される（第二引数として
  # 渡すと「t」という呼び出し名の直後という前提が崩れるため）。
  def log_invalid_input(error)
    logger.warn("[#{self.class.name}##{action_name}] #{error.message}")
  end

  def current_user
    @current_user ||= User.find_by(id: session[:user_id]) if session[:user_id].present?
  end
end
