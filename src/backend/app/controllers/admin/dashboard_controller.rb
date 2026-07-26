module Admin
  class DashboardController < BaseController
    def show
      @report = KpiDashboardReport.new.call
    end
  end
end
