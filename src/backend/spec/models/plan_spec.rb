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

  describe ".find_or_create_by_code!" do
    before do
      UserQuest.delete_all
      User.delete_all
      described_class.delete_all
    end

    context "when the plan already exists" do
      let!(:existing_plan) { described_class.create!(code: "member") }

      it "returns the existing plan without creating a new one" do
        expect(Rails.logger).not_to receive(:warn)
        expect {
          expect(described_class.find_or_create_by_code!("member")).to eq(existing_plan)
        }.not_to change(described_class, :count)
      end
    end

    context "when the plan does not exist" do
      it "creates a new plan, outputs a warning log, and returns it" do
        expect(Rails.logger).to receive(:warn).with(/Plan with code 'member' is missing/)
        expect {
          plan = described_class.find_or_create_by_code!("member")
          expect(plan.code).to eq("member")
        }.to change(described_class, :count).by(1)
      end
    end

    context "when a race condition occurs" do
      it "safely rescues ActiveRecord::RecordInvalid and returns the concurrently created plan" do
        expect(Rails.logger).to receive(:warn).with(/Plan with code 'member' is missing/).once
        expect(Rails.logger).to receive(:warn).with(/was created concurrently/).once

        allow(described_class).to receive(:find_by).with(code: "member").and_return(nil)
        allow(described_class).to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordInvalid.new(described_class.new(code: "member")))

        real_plan = described_class.create!(code: "member")
        allow(described_class).to receive(:find_by!).with(code: "member").and_return(real_plan)

        expect(described_class.find_or_create_by_code!("member")).to eq(real_plan)
      end

      it "safely rescues ActiveRecord::RecordNotUnique and returns the concurrently created plan" do
        expect(Rails.logger).to receive(:warn).with(/Plan with code 'member' is missing/).once
        expect(Rails.logger).to receive(:warn).with(/was created concurrently/).once

        allow(described_class).to receive(:find_by).with(code: "member").and_return(nil)
        allow(described_class).to receive(:find_or_create_by!).and_raise(ActiveRecord::RecordNotUnique.new("Duplicate key value violates unique constraint"))

        real_plan = described_class.create!(code: "member")
        allow(described_class).to receive(:find_by!).with(code: "member").and_return(real_plan)

        expect(described_class.find_or_create_by_code!("member")).to eq(real_plan)
      end
    end
  end
end
