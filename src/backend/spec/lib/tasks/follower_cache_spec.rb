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

  it "runs FollowerCacheSyncJob perform_now" do
    expect(Auth::FollowerCacheSyncJob).to receive(:perform_now)

    Rake::Task["auth:sync_follower_cache"].invoke
  end
end
