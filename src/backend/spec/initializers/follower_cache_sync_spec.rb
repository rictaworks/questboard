require "rails_helper"

RSpec.describe "follower_cache_sync initializer" do
  it "raises when X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN is missing" do
    original = ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"]
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = nil

    expect do
      load Rails.root.join("config/initializers/follower_cache_sync.rb").to_s
    end.to raise_error(StandardError, /X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN/)
  ensure
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = original
  end
end
