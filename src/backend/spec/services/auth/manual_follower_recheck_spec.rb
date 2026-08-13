require "rails_helper"

RSpec.describe Auth::ManualFollowerRecheck do
  include ActiveSupport::Testing::TimeHelpers

  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:client) { instance_double(Auth::XFollowersClient) }
  let(:user) { User.create!(x_user_id: "x-1", display_name: "Ada Lovelace", plan: none_plan) }

  it "raises a cooldown error without reaching the X API when the user rechecks too soon" do
    travel_to(Time.zone.local(2026, 8, 13, 12, 0, 0)) do
      user.update!(manual_rechecked_at: Time.current)

      expect(client).not_to receive(:fetch_followers_page)

      expect do
        described_class.new(
          user:,
          client:,
          target_account_id: "123456789",
          cooldown_minutes: 15,
          page_size: 100
        ).call
      end.to raise_error(Auth::ManualFollowerRecheck::CooldownError) { |error|
        expect(error.remaining_seconds).to eq(900)
      }
    end
  end

  it "locks and commits the cooldown timestamp before calling the X API" do
    expect(client).to receive(:fetch_followers_page) do
      expect(user.reload.manual_rechecked_at).to be_present
      instance_double(Auth::XFollowersClient::Page, ids: [], next_token: nil)
    end

    described_class.new(
      user:,
      client:,
      target_account_id: "123456789",
      cooldown_minutes: 15,
      page_size: 100
    ).call
  end

  it "activates the cooldown even if the X API request fails" do
    expect(client).to receive(:fetch_followers_page).and_raise(StandardError.new("X API down"))

    rechecker = described_class.new(
      user:,
      client:,
      target_account_id: "123456789",
      cooldown_minutes: 15,
      page_size: 100
    )

    # 最初の呼び出しはAPI失敗で例外
    expect { rechecker.call }.to raise_error(StandardError, "X API down")

    # 直後の再試行はAPIを呼ばずに CooldownError
    expect(client).not_to receive(:fetch_followers_page)
    expect { rechecker.call }.to raise_error(Auth::ManualFollowerRecheck::CooldownError)
  end

  describe "concurrent rechecks" do
    self.use_transactional_tests = false
    before do
      User.destroy_all
    end

    after do
      User.destroy_all
    end

    let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
    let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
    let(:user) { User.create!(x_user_id: "x-1", display_name: "Ada Lovelace", plan: none_plan) }

    it "blocks concurrent rechecks from calling the X API more than once" do
      expect(client).to receive(:fetch_followers_page).once do
        sleep 0.1
        instance_double(Auth::XFollowersClient::Page, ids: [], next_token: nil)
      end

      rechecker = described_class.new(
        user:,
        client:,
        target_account_id: "123456789",
        cooldown_minutes: 15,
        page_size: 100
      )

      threads = []
      errors = []

      2.times do
        threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            rechecker.call
          end
        rescue => e
          errors << e
        end
      end

      threads.each(&:join)

      expect(errors.length).to eq(1)
      expect(errors.first).to be_a(Auth::ManualFollowerRecheck::CooldownError)
    end
  end

  describe "差分取得（Issue #133「X APIへ差分取得を実行し」）" do
    # 手動再判定を押すのは定義上 plan=none のユーザー、つまりフォロワー一覧に載っていない
    # ユーザーである。「自分が見つかったら停止」だけを終了条件にすると、正常系がそのまま
    # 最悪ケース（全ページ走査）になり、クールダウンを導入した目的であるレート制限保護を
    # 打ち消す。Auth::FollowerCacheSync の増分同期と同じく、既知のキャッシュ済みIDに
    # 到達した時点で打ち切ること。
    it "stops paging once a already-cached follower id is reached" do
      FollowerCache.create!(x_user_id: "known-1", fetched_at: 1.hour.ago)

      expect(client).to receive(:fetch_followers_page).once.and_return(
        instance_double(Auth::XFollowersClient::Page, ids: [ "new-1", "known-1" ], next_token: "token-2")
      )

      described_class.new(user:, client:, target_account_id: "123456789", cooldown_minutes: 15).call

      expect(FollowerCache.exists?(x_user_id: "new-1")).to be(true)
    end

    it "uses the incremental page size instead of the full-sync page size" do
      expect(client).to receive(:fetch_followers_page)
        .with(hash_including(max_results: Auth::FollowerCacheSync::INCREMENTAL_SYNC_PAGE_SIZE))
        .and_return(instance_double(Auth::XFollowersClient::Page, ids: [], next_token: nil))

      described_class.new(user:, client:, target_account_id: "123456789", cooldown_minutes: 15).call
    end

    # 差分取得は先頭ページしか見ないため「一覧に居ない」ことを証明できない。
    # 降格（member -> none）は全件を走査する定期バッチのフル同期のみが担う。
    it "never demotes an existing member, because a partial fetch cannot prove absence" do
      member = User.create!(x_user_id: "x-member", display_name: "Grace Hopper", plan: member_plan)
      FollowerCache.create!(x_user_id: "x-member", fetched_at: 1.hour.ago)

      allow(client).to receive(:fetch_followers_page).and_return(
        instance_double(Auth::XFollowersClient::Page, ids: [ "someone-else" ], next_token: nil)
      )

      described_class.new(user: member, client:, target_account_id: "123456789", cooldown_minutes: 15).call

      expect(member.reload.plan.code).to eq("member")
      expect(FollowerCache.exists?(x_user_id: "x-member")).to be(true)
    end
  end
end
