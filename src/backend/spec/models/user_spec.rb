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

  describe "FK on_delete 設計" do
    # ユーザー削除時の各テーブルの on_delete 挙動を検証する
    let(:connection) { ActiveRecord::Base.connection }

    def fk_for(from_table, to_table:, column: nil)
      connection.foreign_keys(from_table).find do |fk|
        fk.to_table == to_table.to_s && (column.nil? || fk.column == column.to_s)
      end
    end

    it "board_members → users は cascade" do
      fk = fk_for("board_members", to_table: "users")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:cascade)
    end

    it "comments → users は cascade" do
      fk = fk_for("comments", to_table: "users")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:cascade)
    end

    it "frame_locks(locked_by) → users は cascade" do
      fk = fk_for("frame_locks", to_table: "users", column: "locked_by")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:cascade)
    end

    it "kpi_events → users は nullify（分析ログを匿名化保持）" do
      fk = fk_for("kpi_events", to_table: "users")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:nullify)
    end

    it "kpi_events.user_id は NULL 許可（nullify に必要）" do
      col = connection.columns("kpi_events").find { |c| c.name == "user_id" }
      expect(col.null).to be(true)
    end

    it "object_ops → users は nullify（操作ログを匿名化保持）" do
      fk = fk_for("object_ops", to_table: "users")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:nullify)
    end

    it "object_ops.user_id は NULL 許可（nullify に必要）" do
      col = connection.columns("object_ops").find { |c| c.name == "user_id" }
      expect(col.null).to be(true)
    end

    it "user_quests → users は cascade" do
      fk = fk_for("user_quests", to_table: "users")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:cascade)
    end

    it "user_settings → users は cascade" do
      fk = fk_for("user_settings", to_table: "users")
      expect(fk).not_to be_nil
      expect(fk.on_delete).to eq(:cascade)
    end
  end
end

