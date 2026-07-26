require "rails_helper"

RSpec.describe "Admin KPI dashboard", type: :request do
  around do |example|
    original_username = ENV["ADMIN_BASIC_AUTH_USERNAME"]
    original_password = ENV["ADMIN_BASIC_AUTH_PASSWORD"]

    ENV["ADMIN_BASIC_AUTH_USERNAME"] = "admin"
    ENV["ADMIN_BASIC_AUTH_PASSWORD"] = "secret"

    example.run
  ensure
    ENV["ADMIN_BASIC_AUTH_USERNAME"] = original_username
    ENV["ADMIN_BASIC_AUTH_PASSWORD"] = original_password
  end

  before do
    quest_progress_service = instance_double(QuestProgressService, advance_for_event: true)
    allow(QuestProgressService).to receive(:new).and_return(quest_progress_service)

    seed_kpi_masters
    seed_quests
    seed_intensity_masters
  end

  it "renders computed KPI metrics from persisted data" do
    board_one = Board.create!(title: "Board One")
    board_two = Board.create!(title: "Board Two")

    user_one = User.create!(google_sub: "google-sub-one", display_name: "User One")
    user_two = User.create!(google_sub: "google-sub-two", display_name: "User Two")

    KpiEvent.create!(event_def: EventDef.find_by!(code: "object_created_sticky"), user: user_one, board: board_one, occurred_at: 8.days.ago.change(sec: 0, usec: 0))
    KpiEvent.create!(event_def: EventDef.find_by!(code: "object_created_sticky"), user: user_two, board: board_one, occurred_at: 8.days.ago.change(sec: 0, usec: 0))
    KpiEvent.create!(event_def: EventDef.find_by!(code: "radial_opened"), user: user_one, board: board_one, occurred_at: 7.days.ago.change(sec: 0, usec: 0))
    KpiEvent.create!(event_def: EventDef.find_by!(code: "comment_created"), user: user_one, board: board_two, occurred_at: 1.day.ago.change(sec: 0, usec: 0))
    KpiEvent.create!(event_def: EventDef.find_by!(code: "object_created_sticky"), user: user_two, board: board_two, occurred_at: 8.days.ago.change(sec: 0, usec: 0))
    KpiEvent.create!(event_def: EventDef.find_by!(code: "comment_created"), user: user_two, board: board_two, occurred_at: 7.days.ago.change(sec: 0, usec: 0))

    quests = Quest.where(title: %w[Q1 Q2 Q3 Q4]).order(:title).to_a
    UserQuest.create!(user: user_one, quest: quests[0], state: "completed", progress: 1)
    UserQuest.create!(user: user_one, quest: quests[1], state: "completed", progress: 1)
    UserQuest.create!(user: user_one, quest: quests[2], state: "completed", progress: 1)
    UserQuest.create!(user: user_one, quest: quests[3], state: "in_progress", progress: 0)

    full = IntensityMaster.find_by!(code: "full")
    subtle = IntensityMaster.find_by!(code: "subtle")
    UserSetting.create!(user: user_one, intensity_master: full)
    UserSetting.create!(user: user_two, intensity_master: subtle)

    credentials = ActionController::HttpAuthentication::Basic.encode_credentials("admin", "secret")
    get "/admin", headers: { "Authorization" => credentials }

    expect(response).to have_http_status(:ok)
    expect(response.body).to include("本デモは最小データセットでの検証結果")
    expect(response.body).to include("100.0%")
    expect(response.body).to include("50.0%")
    expect(response.body).to include("1.5人")
    expect(response.body).to include("75.0%")
    expect(response.body).to include("フル")
    expect(response.body).to include("控えめ")
    expect(response.body).to include("オフ")
  end

  private

  def seed_kpi_masters
    EffectMaster.upsert_all(
      [
        { code: "creation_pop", duration_ms: 180 },
        { code: "radial_bloom", duration_ms: 180 },
        { code: "comment_ping", duration_ms: 200 }
      ],
      unique_by: :index_effect_masters_on_code
    )

    effect_ids = EffectMaster.pluck(:code, :id).to_h

    EventDef.upsert_all(
      [
        { code: "object_created_sticky", effect_id: effect_ids.fetch("creation_pop") },
        { code: "radial_opened", effect_id: effect_ids.fetch("radial_bloom") },
        { code: "comment_created", effect_id: effect_ids.fetch("comment_ping") }
      ],
      unique_by: :index_event_defs_on_code
    )
  end

  def seed_quests
    Quest.upsert_all(
      [
        { title: "Q1", condition_event: "object_created_sticky", condition_count: 1 },
        { title: "Q2", condition_event: "object_created_sticky", condition_count: 1 },
        { title: "Q3", condition_event: "object_created_sticky", condition_count: 1 },
        { title: "Q4", condition_event: "object_created_sticky", condition_count: 1 }
      ],
      unique_by: :index_quests_on_title
    )
  end

  def seed_intensity_masters
    IntensityMaster.upsert_all(
      [
        { code: "full" },
        { code: "subtle" },
        { code: "off" }
      ],
      unique_by: :index_intensity_masters_on_code
    )
  end
end
