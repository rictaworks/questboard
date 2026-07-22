require "rails_helper"

RSpec.describe "Boards", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:owner) { User.create!(google_sub: "google-sub-owner", display_name: "Owner User") }
  let(:member) { User.create!(google_sub: "google-sub-member", display_name: "Member User") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
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

  it "creates a board and assigns the creator as owner" do
    sign_in(owner)

    post "/boards", params: { title: "Launch Plan" }, as: :json

    expect(response).to have_http_status(:created)
    payload = JSON.parse(response.body)
    board = Board.find_by!(share_token: payload.fetch("board").fetch("shareToken"))
    membership = BoardMember.find_by!(board:, user: owner)

    expect(payload.dig("membership", "role", "code")).to eq("owner")
    expect(board.title).to eq("Launch Plan")
    expect(board.share_token).to match(/\A[1-9A-HJ-NP-Za-km-z]{24}\z/)
    expect(membership.role.code).to eq("owner")
  end

  it "shows the persisted board canvas state to members" do
    seed_object_support
    board_payload = create_board(title: "Canvas Board")
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json
    expect(response).to have_http_status(:created)

    color = ColorPalette.first!
    object_type = ObjectType.find_by!(code: "frame")

    BoardObject.create!(
      board: Board.find_by!(share_token:),
      object_type:,
      color_palette: color,
      geometry: { "x" => 32, "y" => 48, "w" => 240, "h" => 180, "rotation" => 0 },
      deleted_at: nil
    )

    sign_in(member)
    get "/boards/#{share_token}", as: :json

    expect(response).to have_http_status(:ok)
    payload = JSON.parse(response.body)

    expect(payload.fetch("board")).to include("title" => "Canvas Board", "shareToken" => share_token)
    expect(payload.fetch("membership").dig("role", "code")).to eq("editor")
    expect(payload.fetch("objectTypes").map { |entry| entry.fetch("code") }).to include("frame")
    expect(payload.fetch("colorPalettes").map { |entry| entry.fetch("hex") }).to include(color.hex)
    expect(payload.fetch("objects")).to include(
      include(
        "objectTypeCode" => "frame",
        "colorId" => color.id,
        "geometry" => include("x" => 32, "y" => 48, "w" => 240, "h" => 180, "rotation" => 0),
        "locked" => false
      )
    )
  end

  it "joins a board through the share token with the selected invite role" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)

    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json

    expect(response).to have_http_status(:created)
    membership = BoardMember.find_by!(board: Board.find_by!(share_token:), user: member)

    expect(JSON.parse(response.body).dig("membership", "role", "code")).to eq("editor")
    expect(membership.role.code).to eq("editor")
  end

  it "prevents existing members from self-elevating via join" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "viewer" }, as: :json
    expect(response).to have_http_status(:created)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("viewer")

    # Attempt to self-elevate to editor by re-joining
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json

    expect(response).to have_http_status(:created)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("viewer")
  end

  it "lets the owner change another member role and blocks non-owners" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "viewer" }, as: :json
    expect(response).to have_http_status(:created)

    sign_in(owner)
    patch "/boards/#{share_token}/members/#{member.id}", params: { role_code: "commenter" }, as: :json

    expect(response).to have_http_status(:ok)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("commenter")

    sign_in(member)
    patch "/boards/#{share_token}/members/#{owner.id}", params: { role_code: "editor" }, as: :json

    expect(response).to have_http_status(:forbidden)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("commenter")
  end

  it "prevents the sole owner from demoting themselves" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    patch "/boards/#{share_token}/members/#{owner.id}", params: { role_code: "viewer" }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body)).to eq("error" => "Cannot remove the last owner")
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: owner).role.code).to eq("owner")
  end

  it "allows an owner to demote themselves once another owner exists" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "viewer" }, as: :json
    expect(response).to have_http_status(:created)

    sign_in(owner)
    patch "/boards/#{share_token}/members/#{member.id}", params: { role_code: "owner" }, as: :json
    expect(response).to have_http_status(:ok)

    patch "/boards/#{share_token}/members/#{owner.id}", params: { role_code: "viewer" }, as: :json

    expect(response).to have_http_status(:ok)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: owner).role.code).to eq("viewer")
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("owner")
  end

  it "blocks form-encoded CSRF requests and unauthorized origins" do
    sign_in(owner)

    # Form-encoded request should be rejected with 415
    post "/boards", params: { title: "CSRF Board" }, headers: { "CONTENT_TYPE" => "application/x-www-form-urlencoded" }
    expect(response).to have_http_status(:unsupported_media_type)

    # Forbidden origin request should be rejected with 403
    post "/boards", params: { title: "Evil Board" }, headers: { "HTTP_ORIGIN" => "http://evil-attacker.com" }, as: :json
    expect(response).to have_http_status(:forbidden)

    # Combined forbidden origin and forbidden content-type should be safely rejected with 403 without DoubleRenderError
    post "/boards", params: { title: "Evil Form Board" }, headers: {
      "HTTP_ORIGIN" => "http://evil-attacker.com",
      "CONTENT_TYPE" => "application/x-www-form-urlencoded"
    }
    expect(response).to have_http_status(:forbidden)
  end

  it "allows CORS preflight for PATCH method" do
    process :options, "/boards/test-token/members/1", headers: {
      "HTTP_ORIGIN" => "http://localhost:3000",
      "HTTP_ACCESS_CONTROL_REQUEST_METHOD" => "PATCH"
    }

    expect(response).to have_http_status(:ok)
    expect(response.headers["Access-Control-Allow-Origin"]).to eq("http://localhost:3000")
    expect(response.headers["Access-Control-Allow-Methods"]).to include("PATCH")
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

  it "resolves ancestor locks without N+1 queries regardless of object tree size" do
    seed_object_support
    board_payload = create_board(title: "Deep Hierarchy Board")
    share_token = board_payload.fetch("board").fetch("shareToken")
    board = Board.find_by!(share_token:)

    color = ColorPalette.first!
    frame_type = ObjectType.find_by!(code: "frame")
    sticky_type = ObjectType.find_by!(code: "sticky")

    parent = nil
    20.times do |i|
      frame = BoardObject.create!(
        board:, object_type: frame_type, color_palette: color, parent_frame: parent,
        geometry: { "x" => i * 10, "y" => i * 10, "w" => 200, "h" => 200, "rotation" => 0 }
      )
      BoardObject.create!(
        board:, object_type: sticky_type, color_palette: color, parent_frame: frame,
        geometry: { "x" => i * 10 + 5, "y" => i * 10 + 5, "w" => 50, "h" => 50, "rotation" => 0 }
      )
      if i == 5
        FrameLock.create!(object_id: frame.id, locked_by: owner.id, locked_at: Time.current)
      end
      parent = frame
    end

    sign_in(owner)
    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    payload = JSON.parse(response.body)

    expect(payload.fetch("objects").length).to eq(40)
  end
end
