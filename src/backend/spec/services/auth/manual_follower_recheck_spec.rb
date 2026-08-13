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
end
