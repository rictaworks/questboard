require "rails_helper"
require Rails.root.join("db/migrate/20260724160000_backfill_text_crdt_revision").to_s

RSpec.describe BackfillTextCrdtRevision do
  # BackfillTextCrdtRevision assumes the column already exists (added by
  # AddTextCrdtRevisionToObjects, a separate migration — see PR #55 review) and only ever
  # runs guarded UPDATEs, never DDL. Simulate "column added, not yet backfilled" by
  # resetting every row to 0 rather than removing/re-adding the column.
  around do |example|
    ActiveRecord::Base.connection.execute("UPDATE objects SET text_crdt_revision = 0")
    example.run
  end

  def create_user
    User.create!(google_sub: "google-sub-#{SecureRandom.hex(4)}", display_name: "Migration User")
  end

  def create_board
    Board.create!(title: "Migration Board")
  end

  def create_object_type
    ObjectType.find_or_create_by!(code: "text")
  end

  def create_color_palette
    ColorPalette.find_or_create_by!(hex: "#123456")
  end

  def create_board_object(board:, object_type:, color_palette:)
    BoardObject.create!(
      board:,
      object_type:,
      color_palette:,
      geometry: { "x" => 0, "y" => 0, "w" => 1, "h" => 1, "rotation" => 0 },
      deleted_at: nil
    )
  end

  def create_text_crdt_op(board:, object:, user:, lamport_ts:, client_id:)
    ObjectOp.create!(
      board:,
      board_object: object,
      user:,
      property: "text_crdt",
      value: { "ops" => [ { "insert" => "x" } ] },
      lamport_ts:,
      client_id:
    )
  end

  it "backfills text_crdt_revision to the latest recorded op id for objects with history, and leaves 0 for objects without" do
    user = create_user
    board = create_board
    object_type = create_object_type
    color_palette = create_color_palette

    object_with_history = create_board_object(board:, object_type:, color_palette:)
    op1 = create_text_crdt_op(board:, object: object_with_history, user:, lamport_ts: 1, client_id: "client-a")
    op2 = create_text_crdt_op(board:, object: object_with_history, user:, lamport_ts: 2, client_id: "client-a")

    other_object_with_history = create_board_object(board:, object_type:, color_palette:)
    create_text_crdt_op(board:, object: other_object_with_history, user:, lamport_ts: 1, client_id: "client-b")

    object_without_history = create_board_object(board:, object_type:, color_palette:)

    described_class.new.up

    expect(op2.id).to be > op1.id
    expect(BoardObject.find(object_with_history.id).text_crdt_revision).to eq(op2.id)
    expect(BoardObject.find(object_without_history.id).text_crdt_revision).to eq(0)
  end

  it "backfills correctly across multiple backfill batches" do
    stub_const("BackfillTextCrdtRevision::BACKFILL_BATCH_SIZE", 2)

    user = create_user
    board = create_board
    object_type = create_object_type
    color_palette = create_color_palette

    object_a = create_board_object(board:, object_type:, color_palette:)
    object_b = create_board_object(board:, object_type:, color_palette:)

    # Interleave ops across the two objects so a small batch size must span multiple
    # in_batches iterations and still converge on each object's true latest id.
    create_text_crdt_op(board:, object: object_a, user:, lamport_ts: 1, client_id: "client-a")
    create_text_crdt_op(board:, object: object_b, user:, lamport_ts: 1, client_id: "client-b")
    create_text_crdt_op(board:, object: object_a, user:, lamport_ts: 2, client_id: "client-a")
    latest_op_b = create_text_crdt_op(board:, object: object_b, user:, lamport_ts: 2, client_id: "client-b")
    latest_op_a = create_text_crdt_op(board:, object: object_a, user:, lamport_ts: 3, client_id: "client-a")

    described_class.new.up

    expect(BoardObject.find(object_a.id).text_crdt_revision).to eq(latest_op_a.id)
    expect(BoardObject.find(object_b.id).text_crdt_revision).to eq(latest_op_b.id)
  end

  it "does not clobber a text_crdt_revision a concurrent write already advanced past the backfill's snapshot" do
    user = create_user
    board = create_board
    object_type = create_object_type
    color_palette = create_color_palette

    object = create_board_object(board:, object_type:, color_palette:)
    op1 = create_text_crdt_op(board:, object:, user:, lamport_ts: 1, client_id: "client-a")

    described_class.new.up
    object = object.reload
    expect(object.text_crdt_revision).to eq(op1.id)

    # Simulate the live app committing a newer text_crdt op and advancing text_crdt_revision
    # to it (exactly as ObjectsController#apply_mutation_for! does) — representing this
    # happening after a backfill batch's `maximum(:id)` snapshot was taken but before that
    # batch's own guarded update runs.
    newer_op = create_text_crdt_op(board:, object:, user:, lamport_ts: 2, client_id: "client-a")
    object.update_column(:text_crdt_revision, newer_op.id)

    # Re-invoke the exact guarded update the migration uses per object_id, passing the
    # stale max_id (op1.id) that a snapshot taken before newer_op existed would have
    # computed. Without the `text_crdt_revision < max_id` guard, this would clobber the
    # newer, correct revision back down to the older one.
    described_class.new.send(:backfill_object_revision!, object.id, op1.id)

    expect(BoardObject.find(object.id).text_crdt_revision).to eq(newer_op.id)
  end

  it "is safe to rerun from the top after being interrupted mid-backfill (no DDL to fail on retry)" do
    user = create_user
    board = create_board
    object_type = create_object_type
    color_palette = create_color_palette

    object = create_board_object(board:, object_type:, color_palette:)
    latest_op = create_text_crdt_op(board:, object:, user:, lamport_ts: 1, client_id: "client-a")

    # First (interrupted) run and a second full rerun both just apply the same guarded
    # UPDATEs — unlike a combined add_column-and-backfill migration, there is no DDL here to
    # fail with a "column already exists" error on retry (see PR #55 review).
    described_class.new.up
    expect { described_class.new.up }.not_to raise_error

    expect(BoardObject.find(object.id).text_crdt_revision).to eq(latest_op.id)
  end
end
