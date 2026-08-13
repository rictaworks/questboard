require "rails_helper"

RSpec.describe Auth::FollowerCacheSync do
  let!(:member_plan) { Plan.find_by(code: "member") || Plan.create!(code: "member") }
  let!(:none_plan) { Plan.find_by(code: "none") || Plan.create!(code: "none") }
  let(:client) { instance_double(Auth::XFollowersClient) }

  subject(:sync) do
    described_class.new(
      client: client,
      target_account_id: "123456789",
      page_size: 100,
      full_sync: true
    )
  end

  describe "#call" do
    it "updates the cache, assigns member plans, and revokes unfollowers on full sync" do
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

    it "does not demote bypassed user IDs on full sync" do
      User.create!(x_user_id: "x-1", display_name: "Follower", plan: none_plan)
      User.create!(x_user_id: "x-2", display_name: "Unfollower", plan: member_plan)
      FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.day.ago)
      FollowerCache.create!(x_user_id: "x-2", fetched_at: 1.day.ago)

      allow(client).to receive(:fetch_followers_page).and_return(
        Auth::XFollowersClient::Page.new(ids: %w[x-1], next_token: nil)
      )

      # x-2 をバイパス対象に設定するため、Rails.configuration を stub する
      allow(Rails.configuration.x).to receive(:follower_gate_bypass_user_ids).and_return(Set.new([ "x-2" ]))

      described_class.new(
        client: client,
        target_account_id: "123456789",
        page_size: 100,
        full_sync: true
      ).call

      expect(FollowerCache.exists?(x_user_id: "x-2")).to be(false)
      expect(User.find_by!(x_user_id: "x-2").plan).to eq(member_plan)
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

    it "raises RequestError on pagination token cycle when full sync is enabled" do
      FollowerCache.create!(x_user_id: "x-3", fetched_at: 1.day.ago)
      user = User.create!(x_user_id: "x-3", display_name: "Follower", plan: member_plan)

      allow(client).to receive(:fetch_followers_page).and_return(
        Auth::XFollowersClient::Page.new(ids: %w[x-1], next_token: "A"),
        Auth::XFollowersClient::Page.new(ids: %w[x-2], next_token: "A")
      )

      expect { sync.call }.to raise_error(Auth::XFollowersClient::RequestError, /Pagination token cycle detected/)

      # 既存のキャッシュとプランが維持されていることを確認（降格されない）
      expect(FollowerCache.exists?(x_user_id: "x-3")).to be(true)
      expect(user.reload.plan).to eq(member_plan)
    end

    it "raises RequestError on max pages limit when full sync is enabled" do
      FollowerCache.create!(x_user_id: "x-3", fetched_at: 1.day.ago)
      user = User.create!(x_user_id: "x-3", display_name: "Follower", plan: member_plan)

      token_counter = 0
      allow(client).to receive(:fetch_followers_page) do
        token_counter += 1
        Auth::XFollowersClient::Page.new(ids: [ "x-#{token_counter}" ], next_token: "token-#{token_counter}")
      end

      expect { sync.call }.to raise_error(Auth::XFollowersClient::RequestError, /Max pages limit exceeded/)

      expect(FollowerCache.exists?(x_user_id: "x-3")).to be(true)
      expect(user.reload.plan).to eq(member_plan)
    end

    context "when incremental sync is enabled" do
      subject(:inc_sync) do
        described_class.new(
          client: client,
          target_account_id: "123456789",
          page_size: 100,
          full_sync: false
        )
      end

      it "scans all pages and does not demote existing members" do
        User.create!(x_user_id: "x-1", display_name: "Follower", plan: member_plan)
        User.create!(x_user_id: "x-2", display_name: "Unfollower", plan: member_plan)
        User.create!(x_user_id: "x-3", display_name: "New Follower", plan: none_plan)

        FollowerCache.create!(x_user_id: "x-1", fetched_at: 1.day.ago)
        FollowerCache.create!(x_user_id: "x-2", fetched_at: 1.day.ago)

        expect(client).to receive(:fetch_followers_page).twice.with(
          hash_including(max_results: Auth::FollowerCacheSync::INCREMENTAL_SYNC_PAGE_SIZE)
        ).and_return(
          Auth::XFollowersClient::Page.new(ids: %w[x-3], next_token: "B"),
          Auth::XFollowersClient::Page.new(ids: %w[x-1], next_token: nil)
        )

        result = inc_sync.call

        expect(result.added_count).to eq(1) # x-3 が追加される
        expect(result.removed_count).to eq(0) # x-2 は降格されない（差分同期のため）
        expect(result.confirmed_count).to eq(2) # x-3, x-1

        expect(FollowerCache.pluck(:x_user_id).sort).to eq(%w[x-1 x-2 x-3])
        expect(User.find_by!(x_user_id: "x-1").plan).to eq(member_plan)
        expect(User.find_by!(x_user_id: "x-2").plan).to eq(member_plan)
        expect(User.find_by!(x_user_id: "x-3").plan).to eq(member_plan)
      end

      it "does not raise an error on token cycle and proceeds with partial results safely" do
        FollowerCache.create!(x_user_id: "x-3", fetched_at: 1.day.ago)
        user = User.create!(x_user_id: "x-3", display_name: "Follower", plan: member_plan)

        allow(client).to receive(:fetch_followers_page).and_return(
          Auth::XFollowersClient::Page.new(ids: %w[x-1], next_token: "A"),
          Auth::XFollowersClient::Page.new(ids: %w[x-2], next_token: "A")
        )

        # 差分同期なのでRequestErrorは発生せず、そこまでに取得したフォロワーを同期する
        expect { inc_sync.call }.not_to raise_error

        # 降格は行われないため、既存メンバーは維持される
        expect(FollowerCache.exists?(x_user_id: "x-3")).to be(true)
        expect(user.reload.plan).to eq(member_plan)
      end

      it "does not raise an error on max pages limit and proceeds with partial results safely" do
        FollowerCache.create!(x_user_id: "x-3", fetched_at: 1.day.ago)
        user = User.create!(x_user_id: "x-3", display_name: "Follower", plan: member_plan)

        token_counter = 0
        allow(client).to receive(:fetch_followers_page) do
          token_counter += 1
          Auth::XFollowersClient::Page.new(ids: [ "x-#{token_counter}" ], next_token: "token-#{token_counter}")
        end

        expect { inc_sync.call }.not_to raise_error

        expect(FollowerCache.exists?(x_user_id: "x-3")).to be(true)
        expect(user.reload.plan).to eq(member_plan)
      end
    end
  end
end
