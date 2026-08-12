require "rails_helper"

RSpec.describe "follower_gate initializer" do
  it "raises when X_FOLLOWER_GATE_TARGET_ACCOUNT_ID is missing" do
    original = ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"]
    ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] = nil

    expect do
      load Rails.root.join("config/initializers/follower_gate.rb").to_s
    end.to raise_error(StandardError, /X_FOLLOWER_GATE_TARGET_ACCOUNT_ID/)
  ensure
    ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"] = original
  end
end
