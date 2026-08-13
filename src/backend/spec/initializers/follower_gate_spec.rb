require "rails_helper"

RSpec.describe "follower_gate initializer" do
  let(:original_target_account_id) { ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] }
  let(:original_cooldown_minutes) { ENV["X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES"] }

  after do
    ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] = original_target_account_id
    ENV["X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES"] = original_cooldown_minutes
  end

  it "raises when X_FOLLOWER_GATE_TARGET_ACCOUNT_ID is missing" do
    ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] = nil

    expect do
      load Rails.root.join("config/initializers/follower_gate.rb").to_s
    end.to raise_error(StandardError, /X_FOLLOWER_GATE_TARGET_ACCOUNT_ID/)
  end

  it "loads the manual recheck cooldown with the default value when unset" do
    ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] = "123456789"
    ENV["X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES"] = nil

    load Rails.root.join("config/initializers/follower_gate.rb").to_s

    expect(Rails.configuration.x.follower_gate_manual_recheck_cooldown_minutes).to eq(15)
  end

  it "rejects invalid manual recheck cooldown values" do
    ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] = "123456789"
    ENV["X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES"] = "0"

    expect do
      load Rails.root.join("config/initializers/follower_gate.rb").to_s
    end.to raise_error(StandardError, /X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES/)
  end
end
