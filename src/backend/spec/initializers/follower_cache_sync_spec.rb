require "rails_helper"

RSpec.describe "follower_cache_sync initializer" do
  let(:original_bearer_token) { ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] }
  let(:original_interval_hours) { ENV["X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS"] }

  before do
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = "token"
  end

  after do
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = original_bearer_token
    ENV["X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS"] = original_interval_hours
  end

  it "raises when X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN is missing" do
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = nil

    expect do
      load Rails.root.join("config/initializers/follower_cache_sync.rb").to_s
    end.to raise_error(StandardError, /X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN/)
  end

  it "raises when X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS is not a positive integer" do
    [ "", "abc", "0", "-24" ].each do |invalid_val|
      ENV["X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS"] = invalid_val
      expect do
        load Rails.root.join("config/initializers/follower_cache_sync.rb").to_s
      end.to raise_error(StandardError, /X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS/)
    end
  end

  it "loads the interval hours successfully when valid" do
    ENV["X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS"] = "12"
    load Rails.root.join("config/initializers/follower_cache_sync.rb").to_s
    expect(Rails.configuration.x.follower_cache_full_sync_interval_hours).to eq(12)
  end
end
