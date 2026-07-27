class HealthController < ApplicationController
  def show
    if database_healthy?
      render json: { status: "ok" }
    else
      render json: { status: "unhealthy", checks: { database: "down" } }, status: :service_unavailable
    end
  end

  private

  def database_healthy?
    ActiveRecord::Base.connection.active?
  rescue ActiveRecord::ActiveRecordError
    false
  end
end
