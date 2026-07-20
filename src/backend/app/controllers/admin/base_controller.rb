module Admin
  class BaseController < ApplicationController
    before_action :authenticate_admin!

    private

    def authenticate_admin!
      authenticate_or_request_with_http_basic do |username, password|
        secure_compare(username, admin_username) && secure_compare(password, admin_password)
      end
    end

    def admin_username
      ENV.fetch("ADMIN_BASIC_AUTH_USERNAME")
    end

    def admin_password
      ENV.fetch("ADMIN_BASIC_AUTH_PASSWORD")
    end

    def secure_compare(value, expected)
      ActiveSupport::SecurityUtils.secure_compare(value, expected)
    rescue ArgumentError
      false
    end
  end
end
