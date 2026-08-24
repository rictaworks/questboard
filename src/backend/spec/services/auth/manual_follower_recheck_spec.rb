require "rails_helper"

RSpec.describe Auth::ManualFollowerRecheck do
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:client) { instance_double(Auth::FollowerGateClient) }
  let(:user) { User.create!(x_user_id: "123456789", display_name: "Ada Lovelace", plan: none_plan) }

  def recheck_result(result:, plan: nil, retry_after: nil)
    Auth::FollowerGateClient::RecheckResult.new(
      result: result, retry_after: retry_after, plan: plan, inquiry_id: "123456789"
    )
  end

  it "promotes the user when the gate accepts the recheck and returns the full plan" do
    allow(client).to receive(:request_recheck).with("123456789")
      .and_return(recheck_result(result: "accepted", plan: "full"))

    result = described_class.new(user:, client:).call

    expect(result.plan).to eq(member_plan)
  end

  it "leaves the user on the none plan when the gate still says restricted" do
    allow(client).to receive(:request_recheck).and_return(recheck_result(result: "accepted", plan: "restricted"))

    result = described_class.new(user:, client:).call

    expect(result.plan).to eq(none_plan)
  end

  # 待機は判定サービスが決める。questboard 側で残り時間を数え直すと、画面に出す値と
  # 実際に受理される時刻が食い違う。
  it "raises with the retry time the gate returned when the request is throttled" do
    allow(client).to receive(:request_recheck).and_return(
      recheck_result(result: "throttled", retry_after: "2026-08-25T12:15:00.000+09:00")
    )

    expect { described_class.new(user:, client:).call }
      .to raise_error(described_class::ThrottledError) { |error|
        expect(error.retry_after).to eq("2026-08-25T12:15:00.000+09:00")
      }
  end

  it "does not change the plan when the request is throttled" do
    allow(client).to receive(:request_recheck).and_return(recheck_result(result: "throttled"))
    user.update!(plan: member_plan)

    expect { described_class.new(user:, client:).call }.to raise_error(described_class::ThrottledError)
    expect(user.reload.plan).to eq(member_plan)
  end

  # 判定サービスへ到達できない場合は据え置く。ここで none へ倒すと、上流の障害が
  # 利用者の締め出しになる。
  it "lets a gate failure surface so the controller can report it as a temporary failure" do
    user.update!(plan: member_plan)
    allow(client).to receive(:request_recheck).and_raise(Auth::FollowerGateClient::RequestError, "unavailable")

    expect { described_class.new(user:, client:).call }.to raise_error(Auth::FollowerGateClient::RequestError)
    expect(user.reload.plan).to eq(member_plan)
  end

  # X API を直接呼ぶ経路が生えていないことを固定する。委譲の要点そのもの。
  it "does not reach the X API" do
    source = File.read(Rails.root.join("app/services/auth/manual_follower_recheck.rb"))

    expect(source).not_to match(/api\.x\.com|XFollowersClient|fetch_followers_page/)
  end
end
