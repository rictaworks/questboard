require "spec_helper"
require_relative "../../lib/error_tracking"

RSpec.describe ErrorTracking do
  describe ".sentry_enabled?" do
    it "returns true only in production when a DSN is present" do
      production_env = instance_double("ActiveSupport::StringInquirer", production?: true)
      non_production_env = instance_double("ActiveSupport::StringInquirer", production?: false)

      expect(described_class.sentry_enabled?(env: production_env, dsn: "https://dsn.example/1")).to be(true)
      expect(described_class.sentry_enabled?(env: production_env, dsn: nil)).to be(false)
      expect(described_class.sentry_enabled?(env: non_production_env, dsn: "https://dsn.example/1")).to be(false)
    end
  end
end
