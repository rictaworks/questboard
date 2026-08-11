class ApplicationController < ActionController::API
  include ActionController::Cookies
  include ActionController::HttpAuthentication::Basic::ControllerMethods
  include RequestOriginGuard

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
