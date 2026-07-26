require "rails_helper"

RSpec.describe "KPI events", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:user) { User.create!(google_sub: "google-sub-analytics", display_name: "Analytics User") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
    seed_kpi_masters
  end

  def seed_roles
    Role.upsert_all(
      [
        { code: "owner" },
        { code: "editor" },
        { code: "commenter" },
        { code: "viewer" }
      ],
      unique_by: :index_roles_on_code
    )
  end

  def seed_kpi_masters
    EffectMaster.upsert_all(
      [
        { code: "creation_pop", duration_ms: 180 },
        { code: "zoom_wave", duration_ms: 240 },
        { code: "comment_ping", duration_ms: 200 },
        { code: "share_pulse", duration_ms: 220 }
      ],
      unique_by: :index_effect_masters_on_code
    )

    effect_ids = EffectMaster.pluck(:code, :id).to_h

    EventDef.upsert_all(
      [
        { code: "object_created_sticky", effect_id: effect_ids.fetch("creation_pop") },
        { code: "camera_zoomed", effect_id: effect_ids.fetch("zoom_wave") },
        { code: "comment_created", effect_id: effect_ids.fetch("comment_ping") },
        { code: "board_shared", effect_id: effect_ids.fetch("share_pulse") }
      ],
      unique_by: :index_event_defs_on_code
    )
  end

  def sign_in
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
  end

  def create_board
    sign_in
    post "/boards", params: { title: "Analytics Board" }, as: :json
    expect(response).to have_http_status(:created)
    JSON.parse(response.body).fetch("board")
  end

  it "persists batched KPI events for the active user" do
    board = create_board

    post "/kpi_events", params: {
      events: [
        {
          eventId: "object_created_sticky",
          boardId: board.fetch("id"),
          userId: user.google_sub,
          timestamp: Time.current.iso8601,
          attributes: { objectTypeCode: "sticky", source: "toolbar" }
        },
        {
          eventId: "camera_zoomed",
          boardId: board.fetch("id"),
          userId: user.google_sub,
          timestamp: 1.minute.ago.iso8601,
          attributes: { source: "fit-to-content", zoom: 1.25 }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:created)
    expect(JSON.parse(response.body)).to eq("accepted" => 2)
    expect(KpiEvent.count).to eq(2)
    expect(KpiEvent.pluck(:event_def_id)).to contain_exactly(
      EventDef.find_by!(code: "object_created_sticky").id,
      EventDef.find_by!(code: "camera_zoomed").id
    )
  end

  it "rejects KPI events that carry PII and leaves persistence untouched" do
    board = create_board

    expect(Rails.logger).to receive(:warn).at_least(:once)

    post "/kpi_events", params: {
      events: [
        {
          eventId: "comment_created",
          boardId: board.fetch("id"),
          userId: user.google_sub,
          timestamp: Time.current.iso8601,
          attributes: {
            email: "ada@example.com"
          }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("error")).to match(/PII/i)
    expect(KpiEvent.count).to eq(0)
  end

  it "rejects events whose userId does not match the signed-in user" do
    board = create_board

    post "/kpi_events", params: {
      events: [
        {
          eventId: "board_shared",
          boardId: board.fetch("id"),
          userId: "someone-else",
          timestamp: Time.current.iso8601,
          attributes: { source: "board-create" }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body)).to eq("error" => "userId must match the active Google sub")
    expect(KpiEvent.count).to eq(0)
  end
end
