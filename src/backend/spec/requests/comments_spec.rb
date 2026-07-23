require "rails_helper"

RSpec.describe "Comments", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:owner) { User.create!(google_sub: "google-sub-owner", display_name: "Owner User") }
  let(:editor) { User.create!(google_sub: "google-sub-editor", display_name: "Editor User") }
  let(:commenter) { User.create!(google_sub: "google-sub-commenter", display_name: "Commenter User") }
  let(:viewer) { User.create!(google_sub: "google-sub-viewer", display_name: "Viewer User") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
    seed_comment_support
    seed_object_support
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

  def seed_object_support
    ObjectType.upsert_all(
      [
        { code: "sticky" },
        { code: "shape" },
        { code: "text" },
        { code: "connector" },
        { code: "image" },
        { code: "frame" }
      ],
      unique_by: :index_object_types_on_code
    )

    ColorPalette.upsert_all(
      [
        { hex: "#FDE68A" }
      ],
      unique_by: :index_color_palettes_on_hex
    )
  end

  def seed_comment_support
    EffectMaster.upsert_all(
      [
        { code: "comment_ping", duration_ms: 200 }
      ],
      unique_by: :index_effect_masters_on_code
    )

    EventDef.upsert_all(
      [
        {
          code: "comment_created",
          effect_id: EffectMaster.find_by!(code: "comment_ping").id
        }
      ],
      unique_by: :index_event_defs_on_code
    )
  end

  def sign_in(user)
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
  end

  def create_board(title: "Strategy Board")
    sign_in(owner)
    post "/boards", params: { title: }, as: :json

    expect(response).to have_http_status(:created)
    JSON.parse(response.body)
  end

  def join_board(share_token:, user:, role_code:)
    sign_in(user)
    post "/boards/#{share_token}/join", params: { role_code: }, as: :json

    expect(response).to have_http_status(:created)
  end

  def create_object(share_token:, object_type_code:, geometry:)
    post "/boards/#{share_token}/objects", params: {
      object_type_code:,
      geometry:
    }, as: :json

    expect(response).to have_http_status(:created)
    JSON.parse(response.body)
  end

  def create_comment(share_token:, object_id:, body:)
    post "/boards/#{share_token}/objects/#{object_id}/comments", params: { body: }, as: :json

    expect(response).to have_http_status(:created)
    JSON.parse(response.body)
  end

  it "shows comment badges and comment bodies to members who can view comments" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: commenter, role_code: "commenter")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    sign_in(commenter)
    comment_payload = create_comment(share_token:, object_id:, body: "First comment")

    sign_in(commenter)
    get "/boards/#{share_token}", as: :json

    expect(response).to have_http_status(:ok)
    payload = JSON.parse(response.body)
    board_object = payload.fetch("objects").find { |entry| entry.fetch("id") == object_id }

    expect(board_object.fetch("commentCount")).to eq(1)
    expect(payload.fetch("comments")).to include(
      include(
        "id" => comment_payload.fetch("id"),
        "objectId" => object_id,
        "userId" => commenter.id,
        "userDisplayName" => commenter.display_name,
        "body" => "First comment"
      )
    )

    kpi_event = KpiEvent.find_by!(
      board: Board.find_by!(share_token:),
      user: commenter,
      event_def: EventDef.find_by!(code: "comment_created")
    )
    expect(kpi_event.props).to include("comment_id" => comment_payload.fetch("id"), "object_id" => object_id)
  end

  it "allows commenters to mutate only their own comments while editors can manage all comments" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: commenter, role_code: "commenter")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    sign_in(commenter)
    own_comment = create_comment(share_token:, object_id:, body: "Commenter body")

    sign_in(editor)
    editor_comment = create_comment(share_token:, object_id:, body: "Editor body")

    patch "/boards/#{share_token}/objects/#{object_id}/comments/#{own_comment.fetch('id')}", params: { body: "Updated own body" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).fetch("body")).to eq("Updated own body")

    sign_in(commenter)
    patch "/boards/#{share_token}/objects/#{object_id}/comments/#{editor_comment.fetch('id')}", params: { body: "Blocked update" }, as: :json
    expect(response).to have_http_status(:forbidden)

    sign_in(editor)
    delete "/boards/#{share_token}/objects/#{object_id}/comments/#{own_comment.fetch('id')}", as: :json
    expect(response).to have_http_status(:no_content)
    expect(Comment.find_by(id: own_comment.fetch("id"))).to be_nil

    sign_in(commenter)
    delete "/boards/#{share_token}/objects/#{object_id}/comments/#{editor_comment.fetch('id')}", as: :json
    expect(response).to have_http_status(:forbidden)
    expect(Comment.find_by(id: editor_comment.fetch("id"))).to be_present
  end

  it "hides comment data from viewers" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: viewer, role_code: "viewer")
    join_board(share_token:, user: commenter, role_code: "commenter")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    sign_in(commenter)
    create_comment(share_token:, object_id:, body: "Hidden comment")

    sign_in(viewer)
    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    payload = JSON.parse(response.body)

    expect(payload.fetch("comments")).to eq([])
    expect(payload.fetch("objects").find { |entry| entry.fetch("id") == object_id }.fetch("commentCount")).to be_nil

    get "/boards/#{share_token}/objects/#{object_id}/comments", as: :json
    expect(response).to have_http_status(:forbidden)

    post "/boards/#{share_token}/objects/#{object_id}/comments", params: { body: "Nope" }, as: :json
    expect(response).to have_http_status(:forbidden)
  end

  it "allows owners to edit and delete comments authored by other members" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: commenter, role_code: "commenter")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    sign_in(commenter)
    commenter_comment = create_comment(share_token:, object_id:, body: "Commenter body")

    sign_in(owner)
    patch "/boards/#{share_token}/objects/#{object_id}/comments/#{commenter_comment.fetch('id')}", params: { body: "Updated by owner" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).fetch("body")).to eq("Updated by owner")

    delete "/boards/#{share_token}/objects/#{object_id}/comments/#{commenter_comment.fetch('id')}", as: :json
    expect(response).to have_http_status(:no_content)
    expect(Comment.find_by(id: commenter_comment.fetch("id"))).to be_nil
  end

  it "rejects blank comment bodies with an unprocessable_entity response" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    post "/boards/#{share_token}/objects/#{object_id}/comments", params: { body: "   " }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(Comment.count).to eq(0)
  end

  it "returns not_found for comment operations against a nonexistent object or comment" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")
    missing_object_id = object_id + 1_000
    missing_comment_id = 1_000

    get "/boards/#{share_token}/objects/#{missing_object_id}/comments", as: :json
    expect(response).to have_http_status(:not_found)

    post "/boards/#{share_token}/objects/#{missing_object_id}/comments", params: { body: "Nope" }, as: :json
    expect(response).to have_http_status(:not_found)

    patch "/boards/#{share_token}/objects/#{object_id}/comments/#{missing_comment_id}", params: { body: "Nope" }, as: :json
    expect(response).to have_http_status(:not_found)

    delete "/boards/#{share_token}/objects/#{object_id}/comments/#{missing_comment_id}", as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "returns a server error instead of a misleading not_found when the KPI event definition is missing" do
    EventDef.find_by!(code: "comment_created").destroy!

    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    post "/boards/#{share_token}/objects/#{object_id}/comments", params: { body: "Nope" }, as: :json
    expect(response).to have_http_status(:internal_server_error)
    expect(Comment.count).to eq(0)
  end

  it "excludes comments on soft-deleted objects from the board payload" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")
    create_comment(share_token:, object_id:, body: "Comment on soon-to-be-deleted object")

    delete "/boards/#{share_token}/objects/#{object_id}", as: :json
    expect(response).to have_http_status(:ok)

    board = Board.find_by!(share_token:)
    expect(board.comments).to be_empty

    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).fetch("comments")).to eq([])
  end
end
