require "rails_helper"

RSpec.describe "Objects", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:owner) { User.create!(google_sub: "google-sub-owner", display_name: "Owner User") }
  let(:editor) { User.create!(google_sub: "google-sub-editor", display_name: "Editor User") }
  let(:another_editor) { User.create!(google_sub: "google-sub-editor-2", display_name: "Second Editor User") }
  let(:viewer) { User.create!(google_sub: "google-sub-viewer", display_name: "Viewer User") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
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

  it "creates every supported object type" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")
    supported_types = %w[sticky shape text connector image frame]

    sign_in(editor)
    supported_types.each do |object_type_code|
      post "/boards/#{share_token}/objects", params: {
        object_type_code:,
        geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
      }, as: :json

      expect(response).to have_http_status(:created)
      payload = JSON.parse(response.body)

      expect(payload.fetch("objectTypeCode")).to eq(object_type_code)
      expect(payload.fetch("geometry")).to include(
        "x" => 10,
        "y" => 20,
        "w" => 30,
        "h" => 40,
        "rotation" => 0
      )
      expect(BoardObject.find(payload.fetch("id")).object_type.code).to eq(object_type_code)
    end
  end

  it "moves, resizes, rotates, and tombstones objects while enforcing permissions" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")
    join_board(share_token:, user: viewer, role_code: "viewer")

    sign_in(editor)
    object_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    sign_in(viewer)
    patch "/boards/#{share_token}/objects/#{object_id}/move", params: {
      geometry: { x: 99, y: 88 }
    }, as: :json

    expect(response).to have_http_status(:forbidden)
    expect(BoardObject.find(object_id).geometry).to include("x" => 1, "y" => 2)

    sign_in(editor)
    patch "/boards/#{share_token}/objects/#{object_id}/move", params: {
      geometry: { x: 11, y: 12 }
    }, as: :json

    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 11, "y" => 12, "w" => 3, "h" => 4, "rotation" => 0)

    patch "/boards/#{share_token}/objects/#{object_id}/resize", params: {
      geometry: { w: 13, h: 14 }
    }, as: :json

    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 11, "y" => 12, "w" => 13, "h" => 14, "rotation" => 0)

    patch "/boards/#{share_token}/objects/#{object_id}/rotate", params: {
      geometry: { rotation: 45 }
    }, as: :json

    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("rotation" => 45)

    delete "/boards/#{share_token}/objects/#{object_id}", as: :json

    expect(response).to have_http_status(:ok)
    object = BoardObject.find(object_id)
    expect(object.deleted_at).to be_present
    expect(BoardObject.active.find_by(id: object_id)).to be_nil
  end

  it "allows only the lock holder or owner to unlock" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")
    join_board(share_token:, user: another_editor, role_code: "editor")

    sign_in(editor)
    object_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    post "/boards/#{share_token}/objects/#{object_id}/lock", as: :json
    expect(response).to have_http_status(:ok)
    expect(FrameLock.find_by!(object_id:).locked_by).to eq(editor.id)

    sign_in(another_editor)
    delete "/boards/#{share_token}/objects/#{object_id}/lock", as: :json
    expect(response).to have_http_status(:forbidden)
    expect(FrameLock.find_by!(object_id:).locked_by).to eq(editor.id)

    sign_in(owner)
    delete "/boards/#{share_token}/objects/#{object_id}/lock", as: :json

    expect(response).to have_http_status(:ok)
    expect(FrameLock.find_by(object_id:)).to be_nil
  end
end
