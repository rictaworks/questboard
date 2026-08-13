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

  # この再判定は SessionController#recheck から同期的に呼ばれる（＝利用者のHTTPリクエストを
  # 処理している Puma のワーカースレッド上で動く）。定期バッチと同じ既定の再試行設定のままだと、
  # X が 429 を返したときに x-rate-limit-reset（最大15分先）まで sleep してスレッドを塞ぐ。
  # クールダウンは利用者ごとなので、別々の利用者が同時に押す状況は抑止できない。
  it "builds its X API client without retry backoff because it runs on a user request thread" do
    expect(Auth::XFollowersClient).to receive(:new).with(max_retries: 0).and_return(client)

    described_class.new(
      user:,
      target_account_id: "123456789",
      cooldown_minutes: 15,
      page_size: 100
    )
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

  describe "監査ログと並行実行" do
    # プラン値はアクセス制御の根拠（ApplicationController#require_feature_plan!）であり、
    # その変更と、誰がいつX APIを何ページ消費したかは調査対象になる。
    it "logs who rechecked, how many pages were consumed, and how the plan changed" do
      allow(client).to receive(:fetch_followers_page).and_return(
        instance_double(Auth::XFollowersClient::Page, ids: [ "x-1" ], next_token: nil)
      )
      messages = []
      allow(Rails.logger).to receive(:info) { |message| messages << message }

      described_class.new(user:, client:, target_account_id: "123456789", cooldown_minutes: 15).call

      audit = messages.find { |message| message.include?("ManualFollowerRecheck") }
      expect(audit).to be_present
      expect(audit).to include("x-1")
      expect(audit).to include("none")
      expect(audit).to include("member")
      expect(audit).to include("pages=1")
    end

    # follower_cache は x_user_id が主キー。定期バッチと手動再判定が同時に走ると
    # 同じIDを挿入しうるため、重複で 500 にならないようにする。
    it "does not raise when the same follower id is inserted concurrently" do
      allow(client).to receive(:fetch_followers_page).and_return(
        instance_double(Auth::XFollowersClient::Page, ids: [ "x-1" ], next_token: nil)
      )
      # 「既存IDの照会が済んだ後、書き込みの直前に定期バッチが同じIDを入れた」状況を作る。
      # 照会より前に入れると追加対象から外れてしまい、競合が再現しない。
      injected = false
      allow(FollowerCache).to receive(:transaction).and_wrap_original do |original, *args, &block|
        unless injected
          injected = true
          FollowerCache.create!(x_user_id: "x-1", fetched_at: Time.current)
        end
        original.call(*args, &block)
      end

      expect do
        described_class.new(user:, client:, target_account_id: "123456789", cooldown_minutes: 15).call
      end.not_to raise_error
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

    # キャッシュが空（定期バッチ未実行）の場合は「既知IDに到達」で打ち切れないため、
    # 打ち切り条件が実質ページ数上限だけになる。上限が大きいとボタン1回で大量の
    # リクエストを消費するので、増分前提の小さな上限で頭打ちにすること。
    it "caps the number of X API requests when the cache is cold" do
      # 「既知IDに到達」で打ち切れない状況であることだけを前提にする。
      # テーブル全体が空であることを前提にすると、無関係な行の有無でテストが壊れる。
      expect(FollowerCache.where(x_user_id: (1..20).map { |index| "other-#{index}" })).to be_empty

      call_count = 0
      allow(client).to receive(:fetch_followers_page) do
        call_count += 1
        instance_double(
          Auth::XFollowersClient::Page,
          ids: [ "other-#{call_count}" ],
          next_token: "token-#{call_count}"
        )
      end

      described_class.new(user:, client:, target_account_id: "123456789", cooldown_minutes: 15).call

      expect(call_count).to eq(described_class::MAX_PAGES_LIMIT)
      expect(described_class::MAX_PAGES_LIMIT).to be <= 10
      expect(user.reload.plan.code).to eq("none")
    end

    # 既知IDの判定にキャッシュ全件をメモリへ読み込むと、認証済み利用者が叩ける
    # エンドポイントでフォロワー数に比例したメモリを毎回確保することになる。
    # 判定はそのページのID（最大 INCREMENTAL_SYNC_PAGE_SIZE 件）に絞った索引検索で行う。
    it "checks known ids with a bounded query instead of loading the whole cache" do
      FollowerCache.create!(x_user_id: "known-1", fetched_at: 1.hour.ago)
      expect(FollowerCache).not_to receive(:pluck)

      allow(client).to receive(:fetch_followers_page).and_return(
        instance_double(Auth::XFollowersClient::Page, ids: [ "known-1" ], next_token: "next")
      )

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
