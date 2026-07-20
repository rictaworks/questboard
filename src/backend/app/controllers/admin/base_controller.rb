module Admin
  class BaseController < ApplicationController
    before_action :authenticate_admin!

    private

    def authenticate_admin!
      username_to_check = admin_username
      password_to_check = admin_password

      if username_to_check.blank? || password_to_check.blank?
        request_http_basic_authentication
        return
      end

      authenticate_or_request_with_http_basic do |username, password|
        secure_compare(username, username_to_check) && secure_compare(password, password_to_check)
      end
    end

    def admin_username
      ENV["ADMIN_BASIC_AUTH_USERNAME"].presence
    end

    def admin_password
      ENV["ADMIN_BASIC_AUTH_PASSWORD"].presence
    end

    def secure_compare(value, expected)
      return false if value.blank? || expected.blank?

      ActiveSupport::SecurityUtils.secure_compare(value, expected)
    rescue ArgumentError
      false
    end
  end
end
