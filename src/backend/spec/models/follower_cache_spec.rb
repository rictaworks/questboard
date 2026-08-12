require "rails_helper"

RSpec.describe FollowerCache, type: :model do
  it "uses x_user_id as the primary key" do
    expect(described_class.primary_key).to eq("x_user_id")
  end

  it "requires fetched_at" do
    entry = described_class.new(x_user_id: "x-1", fetched_at: nil)

    expect(entry).not_to be_valid
    expect(entry.errors[:fetched_at]).to include("を入力してください")
  end

  it "persists a follower cache row keyed by x_user_id" do
    now = Time.zone.parse("2026-08-12 09:00:00")
    entry = described_class.create!(x_user_id: "x-1", fetched_at: now)

    expect(described_class.find("x-1")).to eq(entry)
  end
end
