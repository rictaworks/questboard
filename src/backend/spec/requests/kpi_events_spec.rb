require "rails_helper"

RSpec.describe "KPI events", type: :request do
  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let(:user) { User.create!(x_user_id: "x-sub-analytics", display_name: "Analytics User") }

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
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
        { code: "radial_bloom", duration_ms: 180 },
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
        { code: "radial_opened", effect_id: effect_ids.fetch("radial_bloom") },
        { code: "comment_created", effect_id: effect_ids.fetch("comment_ping") },
        { code: "board_shared", effect_id: effect_ids.fetch("share_pulse") }
      ],
      unique_by: :index_event_defs_on_code
    )
  end

  def sign_in
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
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
    KpiEvent.delete_all
    JSON.parse(response.body).fetch("board")
  end

  it "persists batched KPI events for the active user" do
    board = create_board

    post "/kpi_events", params: {
      events: [
        {
          eventId: "radial_opened",
          boardId: board.fetch("id"),
          userId: user.x_user_id,
          timestamp: Time.current.iso8601,
          attributes: { source: "contextmenu" }
        },
        {
          eventId: "camera_zoomed",
          boardId: board.fetch("id"),
          userId: user.x_user_id,
          timestamp: 1.minute.ago.iso8601,
          attributes: { source: "fit-to-content", zoom: 1.25 }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:created)
    expect(JSON.parse(response.body)).to eq("accepted" => 2)
    expect(KpiEvent.count).to eq(2)
    expect(KpiEvent.pluck(:event_def_id)).to contain_exactly(
      EventDef.find_by!(code: "radial_opened").id,
      EventDef.find_by!(code: "camera_zoomed").id
    )
  end

  it "rejects KPI events that carry PII and leaves persistence untouched" do
    board = create_board

    expect(Rails.logger).to receive(:warn).at_least(:once)

    post "/kpi_events", params: {
      events: [
        {
          eventId: "camera_zoomed",
          boardId: board.fetch("id"),
          userId: user.x_user_id,
          timestamp: Time.current.iso8601,
          attributes: {
            source: "fit-to-content",
            zoom: 1.0,
            email: "ada@example.com"
          }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Unknown attributes|PII/i)
    expect(KpiEvent.count).to eq(0)
  end

  it "rejects intensity_changed event with invalid intensity value" do
    board = create_board

    expect(Rails.logger).to receive(:warn).at_least(:once)

    post "/kpi_events", params: {
      events: [
        {
          eventId: "intensity_changed",
          boardId: board.fetch("id"),
          userId: user.x_user_id,
          timestamp: Time.current.iso8601,
          attributes: { intensity: "invalid" }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/invalid value/i)
    expect(KpiEvent.count).to eq(0)
  end

  it "rejects events whose userId does not match the signed-in user" do
    board = create_board

    post "/kpi_events", params: {
      events: [
        {
          eventId: "radial_opened",
          boardId: board.fetch("id"),
          userId: "someone-else",
          timestamp: Time.current.iso8601,
          attributes: { source: "toolbar" }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "userId must match the active X user ID")
    expect(KpiEvent.count).to eq(0)
  end

  it "rejects direct submission of server-side events" do
    board = create_board

    expect(Rails.logger).to receive(:warn).at_least(:once)

    post "/kpi_events", params: {
      events: [
        {
          eventId: "object_created_sticky",
          boardId: board.fetch("id"),
          userId: user.x_user_id,
          timestamp: Time.current.iso8601,
          attributes: { source: "toolbar" }
        }
      ]
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Direct submission of event/i)
    expect(KpiEvent.count).to eq(0)
  end

  it "rejects batch size exceeding 20" do
    board = create_board

    expect(Rails.logger).to receive(:warn).at_least(:once)

    events = 21.times.map do
      {
        eventId: "radial_opened",
        boardId: board.fetch("id"),
        userId: user.x_user_id,
        timestamp: Time.current.iso8601,
        attributes: { source: "toolbar" }
      }
    end

    post "/kpi_events", params: { events: }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/batch size exceeds limit/i)
    expect(KpiEvent.count).to eq(0)
  end

  it "rejects request bodies exceeding 64KB, even when Content-Length is missing or chunked" do
    large_payload = "a" * (65 * 1024)

    # 1. When Content-Length is explicitly set
    post "/kpi_events",
         params: large_payload,
         headers: { "CONTENT_TYPE" => "application/json", "CONTENT_LENGTH" => large_payload.bytesize.to_s }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)

    # 2. When Content-Length is missing (or simulated via chunked encoding)
    post "/kpi_events",
         params: large_payload,
         headers: { "CONTENT_TYPE" => "application/json", "HTTP_TRANSFER_ENCODING" => "chunked" }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)

    # 3. When URL path has a format suffix (e.g., .json)
    post "/kpi_events.json",
         params: large_payload,
         headers: { "CONTENT_TYPE" => "application/json", "CONTENT_LENGTH" => large_payload.bytesize.to_s }

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body).fetch("error")).to match(/Request body size exceeds limit/i)
  end

  describe "rate limiting" do
    let(:memory_store) { ActiveSupport::Cache.lookup_store(:memory_store) }

    before do
      allow(Rails).to receive(:cache).and_return(memory_store)
      Rails.cache.clear
    end

    it "does not consume rate limit quota for authenticated users when unauthenticated requests hit the endpoint from the same IP" do
      board = create_board

      # Clear session cookie to simulate an unauthenticated guest
      cookies.delete("_questboard_session")

      # 1. Hit the endpoint 101 times while unauthenticated.
      # Because require_current_user! runs first, they all return 401 and should not trigger/consume rate limits.
      101.times do
        post "/kpi_events", params: { events: [] }, as: :json, headers: { "REMOTE_ADDR" => "1.2.3.4" }
        expect(response).to have_http_status(:unauthorized)
      end

      # 2. Authenticated user makes a request from the same IP.
      # The quota for the authenticated user must not be exhausted, so the request succeeds with 201.
      sign_in
      post "/kpi_events", params: {
        events: [
          {
            eventId: "radial_opened",
            boardId: board.fetch("id"),
            userId: user.x_user_id,
            timestamp: Time.current.iso8601,
            attributes: { source: "toolbar" }
          }
        ]
      }, as: :json, headers: { "REMOTE_ADDR" => "1.2.3.4" }

      expect(response).to have_http_status(:created)
      expect(KpiEvent.count).to eq(1)
    end
  end
end
