require "rails_helper"

RSpec.describe "follower_cache_sync initializer" do
  let(:original_bearer_token) { ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] }

  before do
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = "token"
  end

  after do
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = original_bearer_token
  end

  it "raises when X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN is missing" do
    ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"] = nil

    expect do
      load Rails.root.join("config/initializers/follower_cache_sync.rb").to_s
    end.to raise_error(StandardError, /X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN/)
  end
end
