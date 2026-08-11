class ApplicationController < ActionController::API
  include ActionController::Cookies
  include ActionController::HttpAuthentication::Basic::ControllerMethods
  include RequestOriginGuard

  # params.require はアプリ全体に散らばっており、アクションごとに rescue を書くと
  # 直し漏れがそのまま英語の応答として残る。ParameterMissing の文言は
  # "param is missing or the value is empty or invalid: <名前>" という形で、
  # 内部のパラメータ名を利用者に見せることにもなる。受け側で一度だけ扱う。
  rescue_from ActionController::ParameterMissing, with: :render_parameter_missing

  private

  def render_parameter_missing(error)
    # どのパラメータが欠けていたかは調査に要るため、応答ではなくログに残す。
    logger.warn("[#{self.class.name}##{action_name}] #{error.message}")

    render json: { error: I18n.t("api.errors.parameter_missing") }, status: :unprocessable_content
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
