module Admin
  class DashboardController < BaseController
    def show
      render json: { status: "ok", area: "admin" }
    end
  end
end
