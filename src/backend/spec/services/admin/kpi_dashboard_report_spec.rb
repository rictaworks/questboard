require "rails_helper"

RSpec.describe Admin::KpiDashboardReport, type: :service do
  let(:now) { Time.zone.parse("2026-07-27 12:00:00") }

  def create_effect_masters
    EffectMaster.upsert_all(
      [
        { code: "creation_pop", duration_ms: 180 },
        { code: "radial_bloom", duration_ms: 180 },
        { code: "recolor_pulse", duration_ms: 140 }
      ],
      unique_by: :index_effect_masters_on_code
    )
  end

  def create_event_def(code, effect_code: "creation_pop")
    effect = EffectMaster.find_by!(code: effect_code)
    EventDef.create!(code: code, effect_id: effect.id)
  end

  def create_user(sub)
    User.create!(google_sub: sub, display_name: sub)
  end

  def create_board(title)
    Board.create!(title: title)
  end

  before { create_effect_masters }

  describe "with no persisted data" do
    it "returns zeroed metrics and an empty intensity distribution" do
      report = described_class.new(now: now).call

      expect(report).to eq(
        d1_retention_rate: 0.0,
        d7_retention_rate: 0.0,
        concurrent_editors_per_board: 0.0,
        radial_menu_reach_rate: 0.0,
        quest_completion_rate: 0.0,
        intensity_distribution: [],
        intensity_total: 0
      )
    end
  end

  describe "quest_completion_rate" do
    it "returns 0.0 when the quest_completed event_def has not been seeded" do
      user = create_user("sub-1")
      Quest.create!(title: "Q1", condition_event: "object_created_sticky", condition_count: 1)

      report = described_class.new(now: now).call

      expect(report.fetch(:quest_completion_rate)).to eq(0.0)
      expect(user).to be_persisted
    end

    it "divides completed events by the full user x quest matrix" do
      quest_completed_def = create_event_def("quest_completed", effect_code: "radial_bloom")
      board = create_board("Board")
      user_one = create_user("sub-1")
      create_user("sub-2")
      Quest.create!(title: "Q1", condition_event: "object_created_sticky", condition_count: 1)
      Quest.create!(title: "Q2", condition_event: "object_created_sticky", condition_count: 1)

      KpiEvent.create!(event_def: quest_completed_def, user: user_one, board: board, occurred_at: now, props: { quest_title: "Q1" })

      report = described_class.new(now: now).call

      # 1 completed event / (2 users x 2 quests) = 25.0%
      expect(report.fetch(:quest_completion_rate)).to eq(25.0)
    end
  end

  describe "concurrent_editors_per_board" do
    it "returns 0.0 when no editing-related event_defs are seeded" do
      report = described_class.new(now: now).call
      expect(report.fetch(:concurrent_editors_per_board)).to eq(0.0)
    end

    it "averages the per-board peak of distinct editors within a one-minute bucket" do
      sticky_def = create_event_def("object_created_sticky")
      board_a = create_board("Board A")
      board_b = create_board("Board B")
      user_one = create_user("sub-1")
      user_two = create_user("sub-2")
      user_three = create_user("sub-3")

      bucket = now.change(sec: 0, usec: 0)

      # Board A: 3 distinct editors in the same minute bucket.
      [ user_one, user_two, user_three ].each do |user|
        KpiEvent.create!(event_def: sticky_def, user: user, board: board_a, occurred_at: bucket)
      end

      # Board B: 1 editor.
      KpiEvent.create!(event_def: sticky_def, user: user_one, board: board_b, occurred_at: bucket)

      report = described_class.new(now: now).call

      # avg(3, 1) = 2.0
      expect(report.fetch(:concurrent_editors_per_board)).to eq(2.0)
    end
  end

  describe "intensity_distribution and intensity_total" do
    it "counts only each user's most recent intensity_changed event" do
      intensity_def = create_event_def("intensity_changed", effect_code: "recolor_pulse")
      board = create_board("Board")
      user = create_user("sub-1")

      IntensityMaster.upsert_all(
        [ { code: "full" }, { code: "subtle" }, { code: "off" } ],
        unique_by: :index_intensity_masters_on_code
      )

      KpiEvent.create!(event_def: intensity_def, user: user, board: board, occurred_at: now - 1.hour, props: { intensity: "full" })
      KpiEvent.create!(event_def: intensity_def, user: user, board: board, occurred_at: now, props: { intensity: "subtle" })

      report = described_class.new(now: now).call

      expect(report.fetch(:intensity_total)).to eq(1)

      subtle_row = report.fetch(:intensity_distribution).find { |row| row.fetch(:code) == "subtle" }
      full_row = report.fetch(:intensity_distribution).find { |row| row.fetch(:code) == "full" }

      expect(subtle_row).to include(count: 1, percentage: 100.0)
      expect(full_row).to include(count: 0, percentage: 0.0)
    end
  end

  describe "retention_rate" do
    it "counts a matured user as retained only if they returned exactly on the target day" do
      sticky_def = create_event_def("object_created_sticky")
      board = create_board("Board")
      user_returned = create_user("sub-returned")
      user_churned = create_user("sub-churned")

      first_date = now - 8.days

      KpiEvent.create!(event_def: sticky_def, user: user_returned, board: board, occurred_at: first_date)
      KpiEvent.create!(event_def: sticky_def, user: user_returned, board: board, occurred_at: first_date + 1.day)

      KpiEvent.create!(event_def: sticky_def, user: user_churned, board: board, occurred_at: first_date)

      report = described_class.new(now: now).call

      expect(report.fetch(:d1_retention_rate)).to eq(50.0)
    end
  end
end
