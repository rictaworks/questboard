require "rails_helper"

RSpec.describe "Object ops", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:owner) { User.create!(google_sub: "google-sub-owner", display_name: "Owner User") }
  let(:editor) { User.create!(google_sub: "google-sub-editor", display_name: "Editor User") }
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
      [ { code: "sticky" }, { code: "text" } ],
      unique_by: :index_object_types_on_code
    )

    ColorPalette.upsert_all(
      [ { hex: "#FDE68A" }, { hex: "#111111" } ],
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

  def create_object(share_token:, geometry:, object_type_code: "sticky")
    post "/boards/#{share_token}/objects", params: {
      object_type_code:,
      geometry:
    }, as: :json

    expect(response).to have_http_status(:created)
    JSON.parse(response.body)
  end

  def apply_op(share_token:, object_id:, property:, value:, lamport_ts:, client_id:)
    post "/boards/#{share_token}/objects/#{object_id}/ops", params: {
      property:,
      value:,
      lamport_ts:,
      client_id:
    }, as: :json
  end

  it "applies a geometry op and records it in object_ops" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 1, client_id: "client-a")

    expect(response).to have_http_status(:ok)
    body = JSON.parse(response.body)
    expect(body.fetch("property")).to eq("geometry")
    expect(body.fetch("value")).to eq({ "x" => 10, "y" => 20 })
    expect(body.fetch("lamportTs")).to eq(1)
    expect(body.fetch("clientId")).to eq("client-a")
    expect(ObjectOp.find_by!(object_id:, client_id: "client-a", lamport_ts: 1)).to be_present
  end

  it "rejects a geometry op whose numeric fields are not actually numeric" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: true, rotation: "bogus" }, lamport_ts: 1, client_id: "client-a")

    expect(response).to have_http_status(:unprocessable_entity)
    expect(BoardObject.find(object_id).geometry).to include("x" => 1, "rotation" => 0)
    expect(ObjectOp.where(object_id:).count).to eq(0)
  end

  it "returns the retried op's own recorded value, not the object's current state from a newer op" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 999, y: 999 }, lamport_ts: 10, client_id: "client-b")
    expect(response).to have_http_status(:ok)

    # client-a retries its original op5 (e.g. after a dropped ack). Even though the
    # object's current geometry now reflects the newer op10 from client-b, the response
    # must echo back exactly what op5 itself persisted — never the object's live state —
    # or a sync-server relaying this response would broadcast op10's value tagged with
    # op5's stale lamport_ts/client_id.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    body = JSON.parse(response.body)
    expect(body.fetch("value")).to eq({ "x" => 10, "y" => 20 })
    expect(body.fetch("lamportTs")).to eq(5)
    expect(body.fetch("clientId")).to eq("client-a")
  end

  it "rejects an op with a lamport_ts that is not newer than the recorded one" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 999, y: 999 }, lamport_ts: 9, client_id: "client-b")
    expect(response).to have_http_status(:conflict)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 999, y: 999 }, lamport_ts: 10, client_id: "client-b")
    expect(response).to have_http_status(:conflict)

    expect(BoardObject.find(object_id).geometry).to include("x" => 10, "y" => 20)
  end

  it "treats a retried op with the same object/client/lamport_ts as an idempotent success" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    expect(ObjectOp.where(object_id:, client_id: "client-a", lamport_ts: 5).count).to eq(1)
  end

  it "applies color and deleted_at ops through the same monotonic check" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")
    color = ColorPalette.find_by!(hex: "#111111")

    apply_op(share_token:, object_id:, property: "color", value: { color_id: color.id }, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).color_id).to eq(color.id)

    apply_op(share_token:, object_id:, property: "deleted_at", value: true, lamport_ts: 2, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).deleted_at).to be_present
  end

  it "merges text_crdt ops instead of rejecting stale lamport timestamps" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "Hello" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    base_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { retain: 5 }, { insert: " world" } ], ref_revision: base_revision }, lamport_ts: 1, client_id: "client-b")
    expect(response).to have_http_status(:ok)

    object = BoardObject.find(object_id)
    expect(object.text_crdt.fetch("text")).to eq("Hello world")
    expect(object.text_crdt).to eq({ "text" => "Hello world" })
    expect(ObjectOp.where(object_id:, property: "text_crdt").count).to eq(2)
  end

  it "rejects a text_crdt op with no ref_revision once history already exists for the object" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "Hello" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # client-b never fetched a baseline revision (e.g. a stale in-memory client) — since
    # text_crdt history already exists for this object, it must resync rather than have its
    # ops applied blindly on top of whatever the object's current state happens to be.
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "oops" } ] }, lamport_ts: 1, client_id: "client-b")
    expect(response).to have_http_status(:conflict)
    body = JSON.parse(response.body)
    expect(body.fetch("resyncRequired")).to be(true)

    expect(BoardObject.find(object_id).text_crdt).to eq({ "text" => "Hello" })
  end

  it "rejects a ref_revision that does not belong to this object's text_crdt history" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")
    other_object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "Hello" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id: other_object_id, property: "text_crdt", value: { ops: [ { insert: "Other" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    other_object_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    # A revision that exists in object_ops but belongs to a *different* object must not be
    # accepted as a valid baseline for this object's history.
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { delete: 1 } ], ref_revision: other_object_revision }, lamport_ts: 11, client_id: "client-a")
    expect(response).to have_http_status(:conflict)
    body = JSON.parse(response.body)
    expect(body.fetch("resyncRequired")).to be(true)

    # A revision number that has never existed at all (far beyond anything recorded) must
    # likewise be rejected rather than silently treated as "no conflicting history".
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { delete: 1 } ], ref_revision: other_object_revision + 1_000_000 }, lamport_ts: 12, client_id: "client-a")
    expect(response).to have_http_status(:conflict)

    expect(BoardObject.find(object_id).text_crdt).to eq({ "text" => "Hello" })
  end

  it "rejects stale text snapshots and keeps the current text_crdt state" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "Hello" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "text_crdt", value: { text: "old" }, lamport_ts: 1, client_id: "client-b")
    expect(response).to have_http_status(:unprocessable_entity)
    expect(BoardObject.find(object_id).text_crdt).to eq({ "text" => "Hello" })
    expect(ObjectOp.where(object_id:, property: "text_crdt").count).to eq(1)
  end

  it "converges concurrent text_crdt edits via OT transform correctly" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    # Set initial text state to "ab"
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "ab" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    base_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    # client-a deletes 'a' at position 0 (referencing the server revision recorded above)
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { delete: 1 } ], ref_revision: base_revision }, lamport_ts: 11, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # client-b deletes 'b' at position 1 (referencing the same server revision)
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { retain: 1 }, { delete: 1 } ], ref_revision: base_revision }, lamport_ts: 11, client_id: "client-b")
    expect(response).to have_http_status(:ok)

    # Since both deleted their respective characters, the document should converge to empty ""
    object = BoardObject.find(object_id)
    expect(object.text_crdt.fetch("text")).to eq("")
  end

  it "transforms correctly when a lower-lamport client's op is actually the later persisted one" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    # client-a (with a high local lamport counter) creates "ab".
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "ab" } ] }, lamport_ts: 100, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    base_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    # client-c (a fresh client with a low local lamport counter) inserts "X" at the start,
    # persisted after client-a's op above.
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "X" }, { retain: 2 } ], ref_revision: base_revision }, lamport_ts: 1, client_id: "client-c")
    expect(response).to have_http_status(:ok)

    # A client that only ever saw base_revision (i.e. "ab", before client-c's insert) now
    # deletes 'b' at position 1. Using client-c's lamport_ts (1, lower than base_revision's
    # producer's 100) as the history cutoff would wrongly skip client-c's op from OT and
    # delete the wrong character from "Xab". The fix must transform against it regardless
    # of its lamport_ts, since it was persisted after base_revision.
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { retain: 1 }, { delete: 1 } ], ref_revision: base_revision }, lamport_ts: 101, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    object = BoardObject.find(object_id)
    expect(object.text_crdt.fetch("text")).to eq("Xa")
  end

  it "rejects a retried text_crdt op whose ref_revision differs from what was recorded" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "ab" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    base_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { delete: 1 } ], ref_revision: base_revision }, lamport_ts: 11, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # Same client_id/lamport_ts/ops as above, but a different ref_revision means the client
    # is asking to transform against a different base state — must not silently replay the
    # previously stored result.
    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { delete: 1 } ], ref_revision: base_revision + 1 }, lamport_ts: 11, client_id: "client-a")
    expect(response).to have_http_status(:conflict)

    expect(ObjectOp.where(object_id:, property: "text_crdt", client_id: "client-a", lamport_ts: 11).count).to eq(1)
  end

  it "rejects a ref_revision so far behind it exceeds the OT history limit" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "a" } ] }, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    base_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    current_ref = base_revision
    (1..(ObjectsController::MAX_OT_HISTORY_LIMIT + 1)).each do |i|
      apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { retain: i }, { insert: "b" } ], ref_revision: current_ref }, lamport_ts: i + 1, client_id: "client-b")
      expect(response).to have_http_status(:ok)
      current_ref = JSON.parse(response.body).fetch("value").fetch("revision")
    end

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { delete: 1 } ], ref_revision: base_revision }, lamport_ts: 2, client_id: "client-a")
    expect(response).to have_http_status(:conflict)
    body = JSON.parse(response.body)
    expect(body.fetch("error")).to match(/ref_revision/)
    expect(body.fetch("resyncRequired")).to be(true)
  end

  it "keeps distinct attributes on adjacent inserts instead of merging them away during OT" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, object_type_code: "text", geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "text_crdt", value: { ops: [ { insert: "xy" } ] }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    base_revision = JSON.parse(response.body).fetch("value").fetch("revision")

    # client-b appends at the very end, persisted after base_revision, so client-a's next
    # op below must be transformed against it.
    apply_op(
      share_token:, object_id:, property: "text_crdt",
      value: { ops: [ { retain: 2 }, { insert: "Z" } ], ref_revision: base_revision },
      lamport_ts: 11, client_id: "client-b"
    )
    expect(response).to have_http_status(:ok)

    # client-a inserts a bold 'a' followed by an italic 'b' at the very start, referencing
    # the same base revision. Transforming this against client-b's trailing append must not
    # collapse the two adjacent inserts into one merged insert that drops the italic 'b'
    # attributes.
    apply_op(
      share_token:, object_id:, property: "text_crdt",
      value: {
        ops: [
          { insert: "a", attributes: { bold: true } },
          { insert: "b", attributes: { italic: true } },
          { retain: 2 }
        ],
        ref_revision: base_revision
      },
      lamport_ts: 11, client_id: "client-a"
    )
    expect(response).to have_http_status(:ok)

    recorded_ops = ObjectOp.find_by!(object_id:, property: "text_crdt", client_id: "client-a", lamport_ts: 11).value.fetch("ops")
    inserts = recorded_ops.select { |op| op["insert"].present? }
    expect(inserts.length).to eq(2)
    expect(inserts[0]).to include("insert" => "a", "attributes" => { "bold" => true })
    expect(inserts[1]).to include("insert" => "b", "attributes" => { "italic" => true })
  end

  it "rejects text_crdt documents that exceed the stored text limit" do
    controller = ObjectsController.new
    existing_state = { "text" => "a" * (ObjectsController::MAX_TEXT_CRDT_TEXT_BYTES - 1) }
    incoming_value = { "ops" => [ { "insert" => "ab" } ] }

    expect do
      controller.send(:merge_text_crdt_state, existing_state, incoming_value)
    end.to raise_error(ObjectsController::InvalidOpValueError, /text_crdt text must not exceed/)
  end

  it "rejects text_crdt snapshots and oversized payloads in validation" do
    controller = ObjectsController.new

    allow(controller).to receive(:params).and_return(ActionController::Parameters.new(value: { "text" => "old" }))
    expect do
      controller.send(:validated_text_crdt_value)
    end.to raise_error(ObjectsController::InvalidOpValueError, /snapshots must not include text/)

    allow(controller).to receive(:params).and_return(ActionController::Parameters.new(value: { "ops" => Array.new(ObjectsController::MAX_TEXT_CRDT_OPS + 1) { { "retain" => 1 } } }))
    expect do
      controller.send(:validated_text_crdt_value)
    end.to raise_error(ObjectsController::InvalidOpValueError, /must not exceed/)

    allow(controller).to receive(:params).and_return(ActionController::Parameters.new(value: { "ops" => [ { "insert" => "x" * (ObjectsController::MAX_TEXT_CRDT_INSERT_BYTES + 1) } ] }))
    expect do
      controller.send(:validated_text_crdt_value)
    end.to raise_error(ObjectsController::InvalidOpValueError, /must not exceed/)

    allow(controller).to receive(:params).and_return(ActionController::Parameters.new(value: { "ops" => [ { "insert" => "x", "attributes" => { "a" => { "b" => { "c" => { "d" => { "e" => true } } } } } } ] }))
    expect do
      controller.send(:validated_text_crdt_value)
    end.to raise_error(ObjectsController::InvalidOpValueError, /must not exceed depth/)
  end

  it "breaks same-timestamp conflicts by client_id ascending" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "color", value: { color_id: ColorPalette.find_by!(hex: "#FDE68A").id }, lamport_ts: 10, client_id: "client-b")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "color", value: { color_id: ColorPalette.find_by!(hex: "#111111").id }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "color", value: { color_id: ColorPalette.find_by!(hex: "#FDE68A").id }, lamport_ts: 10, client_id: "client-c")
    expect(response).to have_http_status(:conflict)

    expect(BoardObject.find(object_id).color_id).to eq(ColorPalette.find_by!(hex: "#111111").id)
  end

  it "rejects edit ops on deleted objects and suggests restore for editors" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "deleted_at", value: true, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 99, y: 99 }, lamport_ts: 2, client_id: "client-b")
    expect(response).to have_http_status(:conflict)
    body = JSON.parse(response.body)
    expect(body.fetch("error")).to match(/deleted/i)
    expect(body.fetch("restoreSuggested")).to be(true)
    expect(BoardObject.find(object_id).geometry).to include("x" => 1, "y" => 2)
  end

  it "rejects ops for viewers and unsupported properties" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: viewer, role_code: "viewer")
    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    sign_in(viewer)
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:forbidden)

    sign_in(editor)
    apply_op(share_token:, object_id:, property: "unknown", value: { x: 10 }, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "rejects an external op whose client_id is the reserved legacy client id" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 1, client_id: "legacy")

    expect(response).to have_http_status(:unprocessable_entity)
    expect(ObjectOp.where(object_id:, client_id: "legacy").count).to eq(0)
  end

  it "rejects a retried client_id/lamport_ts pair whose property or value differs from what was recorded" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 999, y: 999 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:conflict)

    expect(BoardObject.find(object_id).geometry).to include("x" => 10, "y" => 20)
  end

  it "rejects a lamport_ts that jumps implausibly far ahead of the recorded one" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # A malicious or buggy client sending an enormous lamport_ts (e.g. bigint max) must
    # not be able to permanently strand the property — every future legitimate op would
    # otherwise be rejected as stale forever, since no client-supplied value could ever
    # exceed it again.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 30, y: 30 }, lamport_ts: 9_223_372_036_854_775_807, client_id: "attacker")
    expect(response).to have_http_status(:unprocessable_entity)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 11, y: 21 }, lamport_ts: 11, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 11, "y" => 21)
  end

  it "rejects an implausible lamport_ts even as the very first op recorded for a property" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    # No prior op exists for this property yet, so the naive "not newer than the latest
    # recorded" check has nothing to compare against — the jump must still be bounded
    # against a zero baseline, or the very first op could strand the property forever.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 30, y: 30 }, lamport_ts: 9_223_372_036_854_775_807, client_id: "attacker")
    expect(response).to have_http_status(:unprocessable_entity)

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 5, y: 5 }, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)
  end

  it "accepts a large but plausible lamport_ts jump within the allowed bound" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # A client that made many local edits before reconnecting can legitimately submit a
    # lamport_ts well ahead of the last recorded one; the bound must not punish this.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 20, y: 20 }, lamport_ts: 50_010, client_id: "client-a")
    expect(response).to have_http_status(:ok)
  end

  it "tracks the latest op per property so an independent property is not rejected as stale" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")
    color = ColorPalette.find_by!(hex: "#111111")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 10, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # A color op with an earlier lamport_ts than the geometry op must still apply, since
    # the two properties are independently ordered.
    apply_op(share_token:, object_id:, property: "color", value: { color_id: color.id }, lamport_ts: 9, client_id: "client-b")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).color_id).to eq(color.id)
  end

  it "treats a retried delete op as idempotent even though the object is no longer active" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "deleted_at", value: true, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).deleted_at).to be_present

    apply_op(share_token:, object_id:, property: "deleted_at", value: true, lamport_ts: 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)
  end

  it "records the legacy move endpoint in the same object_ops log as apply_op, keeping ordering consistent" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    apply_op(share_token:, object_id:, property: "geometry", value: { x: 10, y: 20 }, lamport_ts: 5, client_id: "client-a")
    expect(response).to have_http_status(:ok)

    # The legacy endpoint (no lamport_ts concept of its own) must still land in the same
    # object_ops ordering timeline as apply_op — otherwise the op log's "latest" pointer
    # would go stale the moment a legacy write changes the object underneath it.
    patch "/boards/#{share_token}/objects/#{object_id}/move", params: { geometry: { x: 20, y: 20 } }, as: :json
    expect(response).to have_http_status(:ok)

    latest_op = ObjectOp.where(object_id:, property: "geometry").order(lamport_ts: :desc).first
    expect(latest_op.lamport_ts).to be > 5
    expect(latest_op.value).to include("x" => 20, "y" => 20)

    # Same-ts conflicts resolve by client_id ascending, so client-a wins over the legacy
    # write at lamport_ts 6 and becomes the confirmed geometry.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 999, y: 999 }, lamport_ts: 6, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 999, "y" => 999)

    # A lexicographically later client id at the same lamport_ts still loses.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 30, y: 30 }, lamport_ts: 6, client_id: "zz-client")
    expect(response).to have_http_status(:conflict)
    expect(BoardObject.find(object_id).geometry).to include("x" => 999, "y" => 999)

    # A client that resyncs and submits a genuinely newer lamport_ts still succeeds on
    # top of the legacy write.
    apply_op(share_token:, object_id:, property: "geometry", value: { x: 30, y: 30 }, lamport_ts: latest_op.lamport_ts + 1, client_id: "client-a")
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 30, "y" => 30)
  end

  it "rejects a legacy geometry mutation whose numeric fields are not actually numeric" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    patch "/boards/#{share_token}/objects/#{object_id}/move", params: { geometry: { x: true } }, as: :json

    expect(response).to have_http_status(:unprocessable_entity)
    expect(BoardObject.find(object_id).geometry).to include("x" => 1)
    expect(ObjectOp.where(object_id:).count).to eq(0)
  end

  it "records the legacy recolor and destroy endpoints in the same object_ops log" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")
    color = ColorPalette.find_by!(hex: "#111111")

    patch "/boards/#{share_token}/objects/#{object_id}/color", params: { color_id: color.id }, as: :json
    expect(response).to have_http_status(:ok)
    expect(ObjectOp.where(object_id:, property: "color").count).to eq(1)
    expect(ObjectOp.where(object_id:, property: "color").first.value).to eq({ "color_id" => color.id })

    delete "/boards/#{share_token}/objects/#{object_id}", as: :json
    expect(response).to have_http_status(:ok)
    expect(ObjectOp.where(object_id:, property: "deleted_at").count).to eq(1)
  end

  it "records a legacy recolor's color_id as the palette's Integer id, not a raw String param" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")
    color = ColorPalette.find_by!(hex: "#111111")

    # application/x-www-form-urlencoded and multipart/form-data are rejected outright by
    # verify_content_type! (see application_controller.rb), so the realistic vector for a
    # String color_id is a JSON body whose value was never parsed to an Integer client-side
    # (e.g. a <select> element's .value) rather than an actual form-encoded request.
    patch "/boards/#{share_token}/objects/#{object_id}/color", params: { color_id: color.id.to_s }, as: :json

    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).color_id).to eq(color.id)
    recorded_value = ObjectOp.where(object_id:, property: "color").first.value
    expect(recorded_value).to eq({ "color_id" => color.id })
    expect(recorded_value.fetch("color_id")).to be_an(Integer)
  end

  it "broadcasts the legacy op via SyncOpRelay so connected clients learn of it" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    fake_relay = instance_double(SyncOpRelay)
    allow(SyncOpRelay).to receive(:new).and_return(fake_relay)
    expect(fake_relay).to receive(:publish) do |board_share_token:, object_op:|
      expect(board_share_token).to eq(share_token)
      expect(object_op.property).to eq("geometry")
      expect(object_op.value).to include("x" => 20, "y" => 20)
    end

    patch "/boards/#{share_token}/objects/#{object_id}/move", params: { geometry: { x: 20, y: 20 } }, as: :json
    expect(response).to have_http_status(:ok)
  end

  it "does not fail the request when SyncOpRelay publishing raises" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    join_board(share_token:, user: editor, role_code: "editor")

    sign_in(editor)
    object_id = create_object(share_token:, geometry: { x: 1, y: 2, w: 3, h: 4, rotation: 0 }).fetch("id")

    fake_relay = instance_double(SyncOpRelay)
    allow(SyncOpRelay).to receive(:new).and_return(fake_relay)
    allow(fake_relay).to receive(:publish).and_raise(SyncOpRelay::PublishError, "redis unreachable")

    patch "/boards/#{share_token}/objects/#{object_id}/move", params: { geometry: { x: 20, y: 20 } }, as: :json

    # Publishing is best-effort real-time notification; object_ops remains the source of
    # truth, so a broken relay must not block the underlying mutation from succeeding.
    expect(response).to have_http_status(:ok)
    expect(BoardObject.find(object_id).geometry).to include("x" => 20, "y" => 20)
  end
end
