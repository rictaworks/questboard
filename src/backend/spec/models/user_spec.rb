require "rails_helper"

RSpec.describe User, type: :model do
  describe "defaults" do
    it "assigns the 'none' plan by default when no plan is specified" do
      none_plan = Plan.find_or_create_by!(code: "none")
      user = User.create!(x_user_id: "x-default-user", display_name: "Default User")

      expect(user.plan).to eq(none_plan)
      expect(user.plan.code).to eq("none")
    end

    it "respects an explicitly assigned plan" do
      member_plan = Plan.find_or_create_by!(code: "member")
      user = User.create!(x_user_id: "x-explicit-user", display_name: "Explicit User", plan: member_plan)

      expect(user.plan).to eq(member_plan)
      expect(user.plan.code).to eq("member")
    end
  end
end
