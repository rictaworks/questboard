require "rails_helper"

RSpec.describe "Objects", type: :request do
  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:owner) { User.create!(x_user_id: "x-sub-owner", display_name: "Owner User") }
  let(:editor) { User.create!(x_user_id: "x-sub-editor", display_name: "Editor User") }
  let(:another_editor) { User.create!(x_user_id: "x-sub-editor-2", display_name: "Second Editor User") }
  let(:viewer) { User.create!(x_user_id: "x-sub-viewer", display_name: "Viewer User") }
  let(:blocked_user) { User.create!(x_user_id: "x-sub-blocked-object", display_name: "Blocked Object User", plan: none_plan) }

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
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
        { hex: "#FDE68A" },
        { hex: "#FCA5A5" },
        { hex: "#FDBA74" },
        { hex: "#86EFAC" },
        { hex: "#93C5FD" },
        { hex: "#C4B5FD" },
        { hex: "#F9A8D4" },
        { hex: "#67E8F9" },
        { hex: "#D1D5DB" },
        { hex: "#1F2937" }
      ],
      unique_by: :index_color_palettes_on_hex
    )
  end

  def sign_in(user)
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
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
    expected_colors = {
      "sticky" => "#FDE68A",
      "shape" => "#C4B5FD",
      "text" => "#D1D5DB",
      "connector" => "#67E8F9",
      "image" => "#FCA5A5",
      "frame" => "#93C5FD"
    }

    sign_in(editor)
    supported_types.each do |object_type_code|
      post "/boards/#{share_token}/objects", params: {
        object_type_code:,
        geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
      }, as: :json

      expect(response).to have_http_status(:created)
      payload = JSON.parse(response.body)

      expect(payload.fetch("objectTypeCode")).to eq(object_type_code)
      expect(payload.fetch("colorId")).to eq(ColorPalette.find_by!(hex: expected_colors.fetch(object_type_code)).id)
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

  it "rejects object creation for users on the none plan before role checks" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    board = Board.find_by!(share_token:)
    BoardMember.create!(board:, user: blocked_user, role: Role.find_by!(code: "editor"))

    sign_in(blocked_user)
    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    }, as: :json

    expect(response).to have_http_status(:forbidden)
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

  it "duplicates and recolors objects through the API" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 10, y: 20, w: 30, h: 40, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    post "/boards/#{share_token}/objects/#{object_id}/duplicate", as: :json
    expect(response).to have_http_status(:created)
    duplicate_payload = JSON.parse(response.body)

    expect(duplicate_payload.fetch("geometry")).to include("x" => 34, "y" => 44, "w" => 30, "h" => 40, "rotation" => 0)
    expect(duplicate_payload.fetch("colorId")).to eq(object_payload.fetch("colorId"))

    color = ColorPalette.create!(hex: "#111111")
    patch "/boards/#{share_token}/objects/#{object_id}/color", params: {
      color_id: color.id
    }, as: :json

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).fetch("colorId")).to eq(color.id)
    expect(BoardObject.find(object_id).color_id).to eq(color.id)
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

  it "rejects edits inside a locked frame for non-holders" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")
    join_board(share_token:, user: another_editor, role_code: "editor")

    sign_in(editor)
    frame_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 200, h: 200, rotation: 0 }
    )
    frame_id = frame_payload.fetch("id")

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: frame_id,
      geometry: { x: 10, y: 10, w: 50, h: 50, rotation: 0 }
    }, as: :json
    expect(response).to have_http_status(:created)
    child_id = JSON.parse(response.body).fetch("id")

    post "/boards/#{share_token}/objects/#{frame_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    sign_in(another_editor)

    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    board_objects = JSON.parse(response.body).fetch("objects")
    child_serialized = board_objects.find { |o| o["id"] == child_id }
    expect(child_serialized.fetch("locked")).to be true
    expect(child_serialized.fetch("lockedByUserId")).to eq(editor.id)

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: frame_id,
      geometry: { x: 12, y: 18, w: 32, h: 32, rotation: 0 }
    }, as: :json
    expect(response).to have_http_status(:forbidden)

    patch "/boards/#{share_token}/objects/#{child_id}/move", params: { geometry: { x: 99, y: 99 } }, as: :json
    expect(response).to have_http_status(:forbidden)

    patch "/boards/#{share_token}/objects/#{child_id}/resize", params: { geometry: { w: 99, h: 99 } }, as: :json
    expect(response).to have_http_status(:forbidden)

    patch "/boards/#{share_token}/objects/#{child_id}/rotate", params: { geometry: { rotation: 90 } }, as: :json
    expect(response).to have_http_status(:forbidden)

    post "/boards/#{share_token}/objects/#{child_id}/duplicate", as: :json
    expect(response).to have_http_status(:forbidden)

    color = ColorPalette.create!(hex: "#999999")
    patch "/boards/#{share_token}/objects/#{child_id}/color", params: { color_id: color.id }, as: :json
    expect(response).to have_http_status(:forbidden)

    delete "/boards/#{share_token}/objects/#{child_id}", as: :json
    expect(response).to have_http_status(:forbidden)
  end

  it "does not allow a child lock holder to edit if parent frame is locked by another user" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")
    join_board(share_token:, user: another_editor, role_code: "editor")

    sign_in(editor)
    frame_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 200, h: 200, rotation: 0 }
    )
    frame_id = frame_payload.fetch("id")

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: frame_id,
      geometry: { x: 10, y: 10, w: 50, h: 50, rotation: 0 }
    }, as: :json
    child_id = JSON.parse(response.body).fetch("id")

    # Editor A (editor) locks the child sticky
    post "/boards/#{share_token}/objects/#{child_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    # Editor B (another_editor) locks the parent frame
    sign_in(another_editor)
    post "/boards/#{share_token}/objects/#{frame_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    # Editor A attempts to move child object -> Should be forbidden because parent frame is locked by B
    sign_in(editor)
    patch "/boards/#{share_token}/objects/#{child_id}/move", params: { geometry: { x: 99, y: 99 } }, as: :json
    expect(response).to have_http_status(:forbidden)
  end

  it "returns type-specific default colors for untouched new objects" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)

    sticky_response = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 0, y: 0, w: 50, h: 50, rotation: 0 }
    )
    shape_response = create_object(
      share_token:,
      object_type_code: "shape",
      geometry: { x: 60, y: 0, w: 50, h: 50, rotation: 0 }
    )
    frame_response = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 120, y: 0, w: 200, h: 200, rotation: 0 }
    )

    expect(sticky_response.fetch("colorId")).to eq(ColorPalette.find_by!(hex: "#FDE68A").id)
    expect(shape_response.fetch("colorId")).to eq(ColorPalette.find_by!(hex: "#C4B5FD").id)
    expect(frame_response.fetch("colorId")).to eq(ColorPalette.find_by!(hex: "#93C5FD").id)
  end

  it "freezes a user's own direct lock release while an ancestor frame is locked by someone else" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")
    join_board(share_token:, user: another_editor, role_code: "editor")

    sign_in(editor)
    frame_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 200, h: 200, rotation: 0 }
    )
    frame_id = frame_payload.fetch("id")

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: frame_id,
      geometry: { x: 10, y: 10, w: 50, h: 50, rotation: 0 }
    }, as: :json
    child_id = JSON.parse(response.body).fetch("id")

    # Editor A (editor) locks the child sticky directly
    post "/boards/#{share_token}/objects/#{child_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    # Editor B (another_editor) locks the parent frame afterwards
    sign_in(another_editor)
    post "/boards/#{share_token}/objects/#{frame_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    # Editor A still holds a direct lock on the child, but cannot release it
    # while the ancestor frame is locked by someone else. This is the current,
    # intentional behavior (see comment on BoardLockResolver#effective_lock):
    # an ancestor lock by another user freezes the whole subtree, including
    # releasing locks the actor already held before the ancestor was locked.
    sign_in(editor)
    delete "/boards/#{share_token}/objects/#{child_id}/lock", as: :json
    expect(response).to have_http_status(:forbidden)
    expect(FrameLock.find_by(object_id: child_id)).to be_present

    # Once B releases the frame lock, A can release their own child lock again.
    sign_in(another_editor)
    delete "/boards/#{share_token}/objects/#{frame_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    sign_in(editor)
    delete "/boards/#{share_token}/objects/#{child_id}/lock", as: :json
    expect(response).to have_http_status(:ok)
    expect(FrameLock.find_by(object_id: child_id)).to be_nil
  end

  it "serializes lockOriginObjectId to distinguish direct vs inherited locks" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    frame_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 200, h: 200, rotation: 0 }
    )
    frame_id = frame_payload.fetch("id")

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: frame_id,
      geometry: { x: 10, y: 10, w: 50, h: 50, rotation: 0 }
    }, as: :json
    child_id = JSON.parse(response.body).fetch("id")

    post "/boards/#{share_token}/objects/#{frame_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    objects = JSON.parse(response.body).fetch("objects")

    parent_data = objects.find { |o| o["id"] == frame_id }
    child_data = objects.find { |o| o["id"] == child_id }

    expect(parent_data.fetch("lockOriginObjectId")).to eq(frame_id)
    expect(child_data.fetch("lockOriginObjectId")).to eq(frame_id)
  end

  it "restricts parent_frame_id to valid frames on the same board" do
    board_a_payload = create_board(title: "Board A")
    share_token_a = board_a_payload.fetch("board").fetch("shareToken")

    board_b_payload = create_board(title: "Board B")
    share_token_b = board_b_payload.fetch("board").fetch("shareToken")

    # Create a frame in Board B
    sign_in(owner)
    object_b = create_object(
      share_token: share_token_b,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 100, h: 100, rotation: 0 }
    )

    # Attempt to create an object in Board A with parent_frame_id from Board B
    post "/boards/#{share_token_a}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: object_b.fetch("id"),
      geometry: { x: 10, y: 10, w: 20, h: 20, rotation: 0 }
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    # 部分一致だと項目名とメッセージが区切りなく連結される不具合（errors.format）を
    # 見逃すため、利用者に出る文言をそのまま突き合わせる。
    expect(JSON.parse(response.body).fetch("error")).to eq("親フレームは同じボード上の有効なフレームを指定してください")
  end

  it "safely creates an object when geometry parameter is omitted" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky"
    }, as: :json

    expect(response).to have_http_status(:created)
    payload = JSON.parse(response.body)
    expect(payload.fetch("geometry")).to include(
      "x" => 0,
      "y" => 0,
      "w" => 100,
      "h" => 100,
      "rotation" => 0
    )
  end

  it "allows child object updates and deletion even after parent frame is deleted" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    parent_frame = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 200, h: 200, rotation: 0 }
    )
    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: parent_frame.fetch("id"),
      geometry: { x: 10, y: 10, w: 50, h: 50, rotation: 0 }
    }, as: :json
    expect(response).to have_http_status(:created)
    child_id = JSON.parse(response.body).fetch("id")

    # Delete parent frame
    delete "/boards/#{share_token}/objects/#{parent_frame.fetch('id')}", as: :json
    expect(response).to have_http_status(:ok)

    # Child sticky should still be moveable and deleteable without parent validation 422 error
    patch "/boards/#{share_token}/objects/#{child_id}/move", params: {
      geometry: { x: 20, y: 20 }
    }, as: :json
    expect(response).to have_http_status(:ok)

    delete "/boards/#{share_token}/objects/#{child_id}", as: :json
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(child_id).deleted_at).to be_present
  end

  it "rejects unlock API requests on child objects with inherited locks" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    frame_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 0, y: 0, w: 200, h: 200, rotation: 0 }
    )
    frame_id = frame_payload.fetch("id")

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      parent_frame_id: frame_id,
      geometry: { x: 10, y: 10, w: 50, h: 50, rotation: 0 }
    }, as: :json
    child_id = JSON.parse(response.body).fetch("id")

    post "/boards/#{share_token}/objects/#{frame_id}/lock", as: :json
    expect(response).to have_http_status(:ok)

    delete "/boards/#{share_token}/objects/#{child_id}/lock", as: :json
    expect(response).to have_http_status(:forbidden)
  end

  # share_token / id はパスセグメントなので空文字にはならないが、空白だけの値
  # （"%20" 等）は届く。params.require はそれを ActionController::ParameterMissing として
  # 扱うため、rescue_from 経由で 422「必要な項目が指定されていません」に化けていた。
  # 存在しないボード/オブジェクトを指したときに届くべき 404 に届かない回帰だった。
  it "returns not found (not the parameter-missing message) for a blank share token on #create" do
    sign_in(owner)

    post "/boards/%20/objects", params: {
      object_type_code: "sticky",
      geometry: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }
    }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードまたはオブジェクト種別が見つかりません")
  end

  it "returns not found (not the parameter-missing message) for a blank share token on #move" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    join_board(share_token:, user: editor, role_code: "editor")
    object_payload = create_object(share_token:, object_type_code: "sticky", geometry: { x: 0, y: 0, w: 10, h: 10, rotation: 0 })
    object_id = object_payload.fetch("id")

    sign_in(editor)
    patch "/boards/%20/objects/#{object_id}/move", params: { geometry: { x: 1, y: 1 } }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードまたはオブジェクトが見つかりません")
  end

  it "returns not found (not the parameter-missing message) for a blank object id on #move" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    patch "/boards/#{share_token}/objects/%20/move", params: { geometry: { x: 1, y: 1 } }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードまたはオブジェクトが見つかりません")
  end

  it "returns not found (not the parameter-missing message) for a blank object id on #apply_op" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    post "/boards/#{share_token}/objects/%20/ops", params: {
      property: "geometry",
      value: { x: 1, y: 1, w: 1, h: 1, rotation: 0 },
      lamport_ts: 1,
      client_id: "client-1"
    }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードまたはオブジェクトが見つかりません")
  end

  it "executes single-object mutations efficiently without loading all board objects" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    board = Board.find_by!(share_token:)

    color = ColorPalette.first!
    sticky_type = ObjectType.find_by!(code: "sticky")

    objects = Array.new(50) do |i|
      BoardObject.create!(
        board:, object_type: sticky_type, color_palette: color,
        geometry: { "x" => i * 10, "y" => 10, "w" => 50, "h" => 50, "rotation" => 0 }
      )
    end
    target_object = objects.first

    sign_in(owner)
    query_count = count_queries do
      patch "/boards/#{share_token}/objects/#{target_object.id}/move", params: {
        geometry: { x: 999, y: 999 }
      }, as: :json
    end

    expect(response).to have_http_status(:ok)
    expect(target_object.reload.geometry.fetch("x")).to eq(999)
    # Must stay flat regardless of the board having 50 other objects; loading
    # the whole board per mutation would scale with that count instead. The
    # threshold has headroom above the object_ops bookkeeping this endpoint now
    # does (one lookup per baseline plus the insert), all scoped by object_id/
    # client_id so none of it scales with board size either.
    expect(query_count).to be < 20
  end

  it "returns conflict when ActiveRecord::RecordNotUnique is raised on locking" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_payload = create_object(
      share_token:,
      object_type_code: "frame",
      geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    # Simulate database unique constraint violation
    allow_any_instance_of(FrameLock).to receive(:save!).and_raise(ActiveRecord::RecordNotUnique.new("Duplicate key"))

    post "/boards/#{share_token}/objects/#{object_id}/lock", as: :json
    expect(response).to have_http_status(:conflict)
    expect(JSON.parse(response.body)).to eq("error" => "オブジェクトは別のユーザーにロックされています")
  end

  it "returns unprocessable_content when lamport_ts is not an integer" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_payload = create_object(
      share_token:,
      object_type_code: "sticky",
      geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }
    )
    object_id = object_payload.fetch("id")

    post "/boards/#{share_token}/objects/#{object_id}/ops", params: {
      property: "geometry",
      value: { x: 1, y: 1, w: 1, h: 1, rotation: 0 },
      lamport_ts: "invalid",
      client_id: "client-1"
    }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "Lamport時刻は整数で入力してください")
  end
end
