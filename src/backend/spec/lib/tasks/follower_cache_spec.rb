require "rails_helper"
require "rake"

RSpec.describe "auth:sync_follower_cache" do
  before :all do
    Rails.application.load_tasks
  end

  before do
    Rake::Task["auth:sync_follower_cache"].reenable
    allow(Auth::FollowerCacheSyncJob).to receive(:perform_now)
  end

  let!(:member_plan) { Plan.find_by(code: "member") || Plan.create!(code: "member") }

  it "runs full sync when the cache is empty" do
    expect(FollowerCache.count).to eq(0)
    expect(Auth::FollowerCacheSyncJob).to receive(:perform_now).with(full_sync: true)

    Rake::Task["auth:sync_follower_cache"].invoke
  end

  it "runs incremental sync when the cache is fresh" do
    FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.hour.ago)
    expect(Auth::FollowerCacheSyncJob).to receive(:perform_now).with(full_sync: false)

    Rake::Task["auth:sync_follower_cache"].invoke
  end

  it "runs full sync when the cache is stale (older than 24 hours)" do
    FollowerCache.create!(x_user_id: "x-1", fetched_at: 25.hours.ago)
    expect(Auth::FollowerCacheSyncJob).to receive(:perform_now).with(full_sync: true)

    Rake::Task["auth:sync_follower_cache"].invoke
  end

  it "respects explicit full_sync argument" do
    FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.hour.ago)
    expect(Auth::FollowerCacheSyncJob).to receive(:perform_now).with(full_sync: true)

    Rake::Task["auth:sync_follower_cache"].invoke("true")
  end

  it "respects explicit X_FOLLOWER_CACHE_FULL_SYNC environment variable" do
    FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.hour.ago)
    stub_const("ENV", ENV.to_h.merge("X_FOLLOWER_CACHE_FULL_SYNC" => "true"))
    expect(Auth::FollowerCacheSyncJob).to receive(:perform_now).with(full_sync: true)

    Rake::Task["auth:sync_follower_cache"].invoke
  end
end
