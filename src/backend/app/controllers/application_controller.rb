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

  def current_user
    @current_user ||= User.find_by(id: session[:user_id]) if session[:user_id].present?
  end
end
