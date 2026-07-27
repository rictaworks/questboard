class UserSettingsController < ApplicationController
  DEFAULT_INTENSITY_CODE = "full"
  VALID_INTENSITY_CODES = %w[full subtle off].freeze

  before_action :require_current_user!

  def show
    render json: serialize_user_setting(user_setting_for_current_user!)
  end

  def update
    intensity_master = intensity_master_for!(params.require(:intensity))
    user_setting = user_setting_for_current_user!

    user_setting.update!(intensity_master:)

    render json: serialize_user_setting(user_setting)
  rescue ActionController::ParameterMissing => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.to_sentence }, status: :unprocessable_entity
  rescue InvalidIntensityError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  private

  class InvalidIntensityError < StandardError; end

  def require_current_user!
    head :unauthorized unless current_user
  end

  def user_setting_for_current_user!
    UserSetting.find_or_create_by!(user: current_user) do |user_setting|
      user_setting.intensity_master = default_intensity_master
    end
  end

  def default_intensity_master
    IntensityMaster.find_by!(code: DEFAULT_INTENSITY_CODE)
  end

  def intensity_master_for!(intensity_code)
    code = intensity_code.to_s
    raise InvalidIntensityError, "Invalid intensity" unless VALID_INTENSITY_CODES.include?(code)

    IntensityMaster.find_by!(code: code)
  end

  def serialize_user_setting(user_setting)
    {
      intensity: user_setting.intensity_master.code
    }
  end
end
