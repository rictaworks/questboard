require "rails_helper"

RSpec.describe Auth::FollowerGate do
  subject(:gate) { described_class.new(client: client) }

  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:client) { instance_double(Auth::FollowerGateClient) }

  def decision(plan:, confirmed: true, recheck_available: false, inquiry_id: "123456789")
    Auth::FollowerGateClient::Decision.new(
      plan: plan, decided_at: nil, recheck_available: recheck_available,
      inquiry_id: inquiry_id, confirmed: confirmed
    )
  end

  it "maps the full plan to the member plan" do
    allow(client).to receive(:fetch_decision).with("123456789").and_return(decision(plan: "full"))

    expect(gate.resolve("123456789").plan).to eq(member_plan)
  end

  it "maps the restricted plan to the none plan" do
    allow(client).to receive(:fetch_decision).and_return(decision(plan: "restricted"))

    expect(gate.resolve("123456789").plan).to eq(none_plan)
  end

  it "carries the inquiry id and the confirmation flag through" do
    allow(client).to receive(:fetch_decision).and_return(
      decision(plan: "restricted", confirmed: false, recheck_available: true, inquiry_id: "999")
    )

    resolution = gate.resolve("999")

    expect(resolution.inquiry_id).to eq("999")
    expect(resolution.confirmed).to be(false)
    expect(resolution.recheck_available).to be(true)
  end

  it "self-heals missing plans" do
    UserQuest.delete_all
    User.delete_all
    Plan.where(code: %w[member none]).delete_all
    allow(client).to receive(:fetch_decision).and_return(decision(plan: "full"))

    expect(gate.resolve("123456789").plan.code).to eq("member")
    expect(Plan.find_by(code: "member")).to be_present
  end

  # 判定・救済は判定サービス側にある。questboard 側にフォロワー集合や例外指定を
  # 持ち込むと判定が2か所へ戻るため、その痕跡が無いことを固定する。
  it "does not read follower data or bypass settings of its own" do
    source = File.read(Rails.root.join("app/services/auth/follower_gate.rb"))

    expect(source).not_to match(/FollowerCache|is_manual_member|bypass/i)
  end
end
