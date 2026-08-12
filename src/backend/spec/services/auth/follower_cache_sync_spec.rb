require "rails_helper"

RSpec.describe Auth::FollowerCacheSync do
  let!(:member_plan) { Plan.create!(code: "member") }
  let!(:none_plan) { Plan.create!(code: "none") }
  let(:client) { instance_double(Auth::XFollowersClient) }

  subject(:sync) do
    described_class.new(
      client: client,
      target_account_id: "123456789",
      page_size: 100
    )
  end

  describe "#call" do
    it "updates the cache, assigns member plans, and revokes unfollowers" do
      User.create!(x_user_id: "x-1", display_name: "Follower", plan: none_plan)
      User.create!(x_user_id: "x-2", display_name: "Unfollower", plan: member_plan)
      User.create!(x_user_id: "x-3", display_name: "New Follower", plan: none_plan)
      FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.day.ago)
      FollowerCache.create!(x_user_id: "x-2", fetched_at: 1.day.ago)

      allow(client).to receive(:fetch_followers_page).and_return(
        Auth::XFollowersClient::Page.new(ids: %w[x-1 x-3], next_token: nil)
      )

      result = sync.call

      expect(result.added_count).to eq(1)
      expect(result.removed_count).to eq(1)
      expect(result.confirmed_count).to eq(2)
      expect(FollowerCache.pluck(:x_user_id).sort).to eq(%w[x-1 x-3])
      expect(User.find_by!(x_user_id: "x-1").plan).to eq(member_plan)
      expect(User.find_by!(x_user_id: "x-2").plan).to eq(none_plan)
      expect(User.find_by!(x_user_id: "x-3").plan).to eq(member_plan)
    end

    it "keeps the cache unchanged when the X API request fails" do
      cache_entry = FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.day.ago)
      user = User.create!(x_user_id: "x-1", display_name: "Follower", plan: member_plan)
      allow(client).to receive(:fetch_followers_page).and_raise(Auth::XFollowersClient::RequestError, "boom")

      expect(Rails.logger).to receive(:error).with("[Auth::FollowerCacheSync] Auth::XFollowersClient::RequestError: boom")

      expect { sync.call }.to raise_error(Auth::XFollowersClient::RequestError, "boom")

      expect(FollowerCache.find("x-1")).to eq(cache_entry)
      expect(User.find(user.id).plan).to eq(member_plan)
    end
  end
end
