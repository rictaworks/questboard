require "rails_helper"

RSpec.describe "Boards", type: :request do
  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:owner) { User.create!(x_user_id: "x-sub-owner", display_name: "Owner User") }
  let(:member) { User.create!(x_user_id: "x-sub-member", display_name: "Member User") }
  let(:viewer) { User.create!(x_user_id: "x-sub-viewer", display_name: "Viewer User") }
  let(:blocked_user) { User.create!(x_user_id: "x-sub-blocked-board", display_name: "Blocked Board User", plan: none_plan) }

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
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

  def delete_board(share_token)
    delete "/boards/#{share_token}", as: :json
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

  it "rejects board creation for users on the none plan" do
    sign_in(blocked_user)

    post "/boards", params: { title: "Blocked Board" }, as: :json

    expect(response).to have_http_status(:forbidden)
  end

  it "returns a Japanese validation message when the board title is blank" do
    sign_in(owner)

    post "/boards", params: { title: "   " }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "タイトルを入力してください")
  end

  it "returns the same Japanese message when the board title key is absent" do
    # 利用者から見れば空白を送った場合と同じ「タイトルが無い」事象。キーごと欠けたときだけ
    # ActionController::ParameterMissing の英語（内部のパラメータ名を含む）が出ていた。
    sign_in(owner)

    post "/boards", params: {}, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "タイトルを入力してください")
  end

  it "logs when the title key itself is missing, unlike a deliberately blank title" do
    # 応答は同じ日本語メッセージになるため、キー名の取り違え（例: boardTitle）と
    # 意図的な空欄をログ側で見分けられるようにしておく。
    sign_in(owner)
    allow(Rails.logger).to receive(:warn)

    post "/boards", params: {}, as: :json

    expect(Rails.logger).to have_received(:warn).with(/title key missing from params/)
  end

  it "trims leading and trailing whitespace from the board title" do
    sign_in(owner)

    post "/boards", params: { title: "  設計会議  " }, as: :json

    expect(response).to have_http_status(:created)
    payload = JSON.parse(response.body)
    board = Board.find_by!(share_token: payload.fetch("board").fetch("shareToken"))
    expect(board.title).to eq("設計会議")
  end

  # JSON の値は文字列とは限らない。真偽値や数値をそのまま渡すと "t" や "0" という
  # 空でない文字列に寄せられ、presence バリデーションを通ってしまう。
  # 配列やハッシュは strong parameters が非スカラーとして落とすため、送っているのに
  # 「入力してください」と返ることになる。どちらも「空」とは原因が違うので文言を分ける。
  [ false, true, 0, [ "会議ボード" ], { "ja" => "会議ボード" } ].each do |non_string|
    it "rejects a #{non_string.inspect} board title" do
      sign_in(owner)

      expect {
        post "/boards", params: { title: non_string }, as: :json
      }.not_to change(Board, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("error" => "タイトルの形式が正しくありません")
    end
  end

  it "returns a Japanese message when a required parameter is missing" do
    # ParameterMissing の文言は "param is missing or the value is empty or invalid: role_code"
    # という英語で、内部のパラメータ名を含む。params.require はアプリ全体に散らばっているため、
    # アクションごとに rescue を書くと直し漏れがそのまま英語の応答として残る。
    sign_in(owner)
    board_payload = create_board(title: "Role Board")
    share_token = board_payload.fetch("board").fetch("shareToken")

    patch "/boards/#{share_token}/members/#{member.id}", params: {}, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "必要な項目が指定されていません")
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
      text_crdt: { "ops" => [ { "insert" => "Hello" } ] },
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
        "textCrdt" => include("ops" => [ { "insert" => "Hello" } ]),
        "textCrdtRevision" => 0,
        "locked" => false
      )
    )
  end

  it "returns the board-wide latest lamport_ts so a reloaded client does not restart its counter at 0" do
    seed_object_support
    board_payload = create_board(title: "Canvas Board")
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json
    expect(response).to have_http_status(:created)

    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    # op が1件も無いボードでは 0。クライアントはここから ++ して 1 を送れる。
    expect(JSON.parse(response.body).fetch("lamportTs")).to eq(0)

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "sticky",
      geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }
    }, as: :json
    expect(response).to have_http_status(:created)
    object_id = JSON.parse(response.body).fetch("id")

    [ 1, 2, 3 ].each do |ts|
      post "/boards/#{share_token}/objects/#{object_id}/ops", params: {
        property: "geometry",
        value: { x: ts * 10, y: 0 },
        lamport_ts: ts,
        client_id: "client-a"
      }, as: :json
      expect(response).to have_http_status(:ok)
    end

    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    latest_lamport_ts = JSON.parse(response.body).fetch("lamportTs")
    expect(latest_lamport_ts).to eq(3)

    # 再読み込み直後のクライアント（別 client_id）がこの値の次から採番すれば、
    # 履歴のあるプロパティへの最初の編集が LWW で拒否されない（Issue #86）。
    post "/boards/#{share_token}/objects/#{object_id}/ops", params: {
      property: "geometry",
      value: { x: 777, y: 0 },
      lamport_ts: latest_lamport_ts + 1,
      client_id: "client-b"
    }, as: :json
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 777)
  end

  it "returns a text_crdt revision from the board endpoint that a client can use as ref_revision" do
    seed_object_support
    board_payload = create_board(title: "Canvas Board")
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json
    expect(response).to have_http_status(:created)

    post "/boards/#{share_token}/objects", params: {
      object_type_code: "text",
      geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }
    }, as: :json
    expect(response).to have_http_status(:created)
    object_id = JSON.parse(response.body).fetch("id")

    post "/boards/#{share_token}/objects/#{object_id}/ops", params: {
      property: "text_crdt",
      value: { ops: [ { insert: "Hello" } ] },
      lamport_ts: 1,
      client_id: "client-a"
    }, as: :json
    expect(response).to have_http_status(:ok)
    op_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    get "/boards/#{share_token}", as: :json
    expect(response).to have_http_status(:ok)
    board_object = JSON.parse(response.body).fetch("objects").find { |entry| entry.fetch("id") == object_id }

    # The board endpoint's revision must match the exact revision apply_op returned for the
    # op that produced the current text, so a client that only ever loads objects through
    # this endpoint (never a per-object fetch) still has a valid ref_revision to send with
    # its next edit — otherwise every first edit would be rejected as resync-required with
    # no way to recover (see PR #55 review).
    expect(board_object.fetch("textCrdtRevision")).to eq(op_revision)

    # That revision must actually be usable as ref_revision for a follow-up edit.
    post "/boards/#{share_token}/objects/#{object_id}/ops", params: {
      property: "text_crdt",
      value: { ops: [ { retain: 5 }, { insert: " world" } ], ref_revision: board_object.fetch("textCrdtRevision") },
      lamport_ts: 2,
      client_id: "client-a"
    }, as: :json
    expect(response).to have_http_status(:ok)
    text_crdt = BoardObject.find(object_id).text_crdt
    expect(text_crdt.fetch("ops").sum("") { |op| op.fetch("insert") }).to eq("Hello world")
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

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "最後のオーナーは削除できません")
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: owner).role.code).to eq("owner")
  end

  it "deletes a board for the owner, tombstones its objects, and notifies sync-server" do
    board_payload = create_board(title: "Disposable Board")
    share_token = board_payload.fetch("board").fetch("shareToken")
    board = Board.find_by!(share_token:)
    color = ColorPalette.create!(hex: "#abcdef")
    object_type = ObjectType.create!(code: "sticky")
    BoardObject.create!(
      board:,
      object_type:,
      color_palette: color,
      geometry: { "x" => 1, "y" => 2, "w" => 3, "h" => 4, "rotation" => 0 },
      deleted_at: nil
    )
    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json
    expect(response).to have_http_status(:created)

    fake_relay = instance_double(SyncOpRelay)
    allow(SyncOpRelay).to receive(:new).and_return(fake_relay)
    expect(fake_relay).to receive(:publish) do |board_share_token:, object_op:|
      expect(board_share_token).to eq(share_token)
      expect(object_op).to have_attributes(property: "board_deleted", client_id: "legacy", value: {})
    end

    sign_in(owner)
    delete_board(share_token)

    expect(response).to have_http_status(:no_content)
    expect(Board.active.find_by(share_token:)).to be_nil
    expect(Board.find_by!(share_token:).deleted_at).to be_present
    expect(BoardMember.where(board:).count).to eq(0)
    expect(BoardObject.find_by!(board:, object_type:).deleted_at).to be_present
  end

  it "forbids editors and viewers from deleting the board" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json
    expect(response).to have_http_status(:created)

    sign_in(viewer)
    post "/boards/#{share_token}/join", params: { role_code: "viewer" }, as: :json
    expect(response).to have_http_status(:created)

    sign_in(member)
    delete_board(share_token)
    expect(response).to have_http_status(:forbidden)

    sign_in(viewer)
    delete_board(share_token)
    expect(response).to have_http_status(:forbidden)
  end

  it "returns not found when a non-member tries to delete the board" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(viewer)
    delete_board(share_token)

    expect(response).to have_http_status(:not_found)
  end

  # share_token はパスセグメントなので空文字にはならないが、空白だけの値
  # （"%20" 等）は届く。params.require はそれを ActionController::ParameterMissing として
  # 扱うため、rescue_from 経由で 422「必要な項目が指定されていません」に化けていた。
  # 存在しない共有リンクを開いた利用者が届くべき 404 に届かない回帰だった。
  def request_with_blank_share_token(action_name)
    case action_name
    when "show" then get "/boards/%20", as: :json
    when "join" then post "/boards/%20/join", params: { role_code: "editor" }, as: :json
    when "destroy" then delete "/boards/%20", as: :json
    end
  end

  %w[show join destroy].each do |action_name|
    it "returns not found (not the parameter-missing message) for a blank share token on ##{action_name}" do
      sign_in(owner)

      request_with_blank_share_token(action_name)

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)).to eq("error" => "ボードが見つかりません")
    end
  end

  it "returns not found (not the parameter-missing message) for a blank share token on #update_member_role" do
    sign_in(owner)

    patch "/boards/%20/members/#{member.id}", params: { role_code: "editor" }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードが見つかりません")
  end

  # user_id も share_token と同じくパスセグメント（routes.rb の :user_id）。
  it "returns not found (not the parameter-missing message) for a blank user id on #update_member_role" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(owner)
    patch "/boards/#{share_token}/members/%20", params: { role_code: "editor" }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードが見つかりません")
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
    expect(JSON.parse(response.body)).to eq("error" => "Content-Type は application/json である必要があります")

    # Forbidden origin request should be rejected with 403
    post "/boards", params: { title: "Evil Board" }, headers: { "HTTP_ORIGIN" => "http://evil-attacker.com" }, as: :json
    expect(response).to have_http_status(:forbidden)
    expect(JSON.parse(response.body)).to eq("error" => "許可されていないオリジンです")

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
    query_count = count_queries { get "/boards/#{share_token}", as: :json }
    expect(response).to have_http_status(:ok)
    payload = JSON.parse(response.body)

    expect(payload.fetch("objects").length).to eq(40)
    # Query count must stay flat regardless of tree depth/size; a per-object
    # lock lookup would scale with the 40 objects created above.
    expect(query_count).to be < 20
  end

  it "returns unprocessable_content when joining with an unsupported invite role" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "owner" }, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)).to eq("error" => "招待された権限に対応していません")
  end

  it "returns not found when updating member role with an invalid role code" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "editor" }, as: :json

    sign_in(owner)
    patch "/boards/#{share_token}/members/#{member.id}", params: { role_code: "invalid_role" }, as: :json

    expect(response).to have_http_status(:not_found)
    expect(JSON.parse(response.body)).to eq("error" => "ボードが見つかりません")
  end
end
