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
end
