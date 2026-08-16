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

  describe "deletion policy" do
    it "destroys owned rows and retains audit rows without a user reference" do
      user = User.create!(x_user_id: "x-delete-policy-user", display_name: "Delete Policy User")
      board = Board.create!(title: "Delete Policy Board")
      role = Role.find_or_create_by!(code: "viewer")
      object_type = ObjectType.find_or_create_by!(code: "sticky")
      color = ColorPalette.find_or_create_by!(hex: "#111111")
      quest = Quest.find_or_create_by!(title: "delete-policy-quest", condition_event: "comment_created", condition_count: 1)
      intensity = IntensityMaster.find_or_create_by!(code: "full")
      effect = EffectMaster.find_or_create_by!(code: "delete_policy_effect", duration_ms: 1000)
      event_def = EventDef.find_or_create_by!(code: "delete_policy_event", effect_id: effect.id)
      board_object = BoardObject.create!(
        board:,
        object_type:,
        color_palette: color,
        geometry: {},
        text_crdt: {}
      )

      BoardMember.create!(board:, user:, role:)
      Comment.create!(board_object:, user:, body: "Delete me")
      FrameLock.create!(board_object:, locked_by_user: user, locked_at: Time.current)
      UserQuest.create!(user:, quest:)
      UserSetting.create!(user:, intensity_master: intensity)
      ObjectOp.create!(board:, board_object:, user:, property: "geometry", value: {}, lamport_ts: 1, client_id: "delete-policy")
      KpiEvent.create!(event_def:, user:, board:, occurred_at: Time.current)

      expect { user.destroy! }.to change(BoardMember, :count).by(-1)
        .and change(Comment, :count).by(-1)
        .and change(FrameLock, :count).by(-1)
        .and change(UserQuest, :count).by(-1)
        .and change(UserSetting, :count).by(-1)

      expect(ObjectOp.count).to eq(1)
      expect(ObjectOp.first.user_id).to be_nil
      expect(KpiEvent.count).to eq(1)
      expect(KpiEvent.first.user_id).to be_nil
    end
  end
end
