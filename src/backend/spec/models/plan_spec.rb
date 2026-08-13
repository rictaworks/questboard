require "rails_helper"

RSpec.describe Plan, type: :model do
  it "requires a code" do
    plan = described_class.new(code: nil)

    expect(plan).not_to be_valid
    expect(plan.errors[:code]).to include("を入力してください")
  end

  it "requires the code to be unique" do
    described_class.create!(code: "free")
    duplicate = described_class.new(code: "free")

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:code]).to include("はすでに存在します")
  end

  it "is associated with many users" do
    plan = described_class.create!(code: "premium")
    user = User.create!(x_user_id: "x-1", display_name: "Alice", plan:)

    expect(plan.users).to include(user)
  end
end
