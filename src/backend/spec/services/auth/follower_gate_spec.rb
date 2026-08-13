require "rails_helper"

RSpec.describe Auth::FollowerGate do
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }

  it "returns the member plan when the follower cache contains the user" do
    FollowerCache.create!(x_user_id: "x-1", fetched_at: Time.current)

    plan = described_class.new.resolve_plan("x-1")

    expect(plan).to eq(member_plan)
  end

  it "returns the none plan when the follower cache misses the user" do
    plan = described_class.new.resolve_plan("x-2")

    expect(plan).to eq(none_plan)
  end

  it "returns the member plan when the user is in the bypass list" do
    gate = described_class.new(bypass_user_ids: Set.new([ "x-3" ]))
    plan = gate.resolve_plan("x-3")

    expect(plan).to eq(member_plan)
  end
end
