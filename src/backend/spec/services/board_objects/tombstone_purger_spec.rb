require "rails_helper"

RSpec.describe BoardObjects::TombstonePurger do
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let(:user) { User.create!(x_user_id: "x-purge", display_name: "Purge User", plan: member_plan) }
  let(:board) { Board.create!(title: "Purge Board", share_token: "purge-token") }

  before do
    ObjectType.upsert_all(
      [ { code: "sticky" }, { code: "frame" } ],
      unique_by: :index_object_types_on_code
    )
    ColorPalette.upsert_all([ { hex: "#FDE68A" } ], unique_by: :index_color_palettes_on_hex)
  end

  def create_object(deleted_at:, code: "sticky", parent_frame: nil)
    BoardObject.create!(
      board:,
      object_type: ObjectType.find_by!(code:),
      color_palette: ColorPalette.find_by!(hex: "#FDE68A"),
      geometry: { "x" => 0, "y" => 0, "w" => 10, "h" => 10, "rotation" => 0 },
      deleted_at:,
      parent_frame:
    )
  end

  let(:retention) { BoardObject::TOMBSTONE_RETENTION }

  it "保持期間を超えた tombstone だけを削除する" do
    expired = create_object(deleted_at: retention.ago - 1.day)
    recent = create_object(deleted_at: 1.day.ago)
    active = create_object(deleted_at: nil)

    result = described_class.new.call

    expect(result.purged).to eq(1)
    expect(BoardObject.exists?(expired.id)).to be(false)
    expect(BoardObject.exists?(recent.id)).to be(true)
    expect(BoardObject.exists?(active.id)).to be(true)
  end

  # objects を参照する外部キーのうち object_ops にはモデル側の dependent 指定が無い。
  # 明示的に消さないと FK 違反で落ちるため、削除まで確認する。
  it "object_ops / comments / frame_locks も併せて削除する" do
    expired = create_object(deleted_at: retention.ago - 1.day)
    ObjectOp.create!(board:, board_object: expired, user:, property: "geometry",
                     value: { "x" => 1 }, lamport_ts: 1, client_id: "c1")
    Comment.create!(board_object: expired, user:, body: "消える想定")
    FrameLock.create!(board_object: expired, locked_by_user: user, locked_at: Time.current)

    expect { described_class.new.call }.not_to raise_error

    expect(ObjectOp.where(object_id: expired.id)).to be_empty
    expect(Comment.where(object_id: expired.id)).to be_empty
    expect(FrameLock.where(object_id: expired.id)).to be_empty
    expect(BoardObject.exists?(expired.id)).to be(false)
  end

  # 生きているオブジェクトの親フレームを消すと FK 違反になるうえ所属が壊れる。
  # 実際の順序どおり「フレームが生きている間に子を作り、後からフレームだけ削除される」
  # 状態を作る（削除済みフレームを親に指定した新規作成はバリデーションが弾くため）。
  it "生存中オブジェクトから参照されている親フレームは削除せず残す" do
    frame = create_object(deleted_at: nil, code: "frame")
    child = create_object(deleted_at: nil, parent_frame: frame)
    frame.update_column(:deleted_at, retention.ago - 1.day)

    result = described_class.new.call

    expect(result.purged).to eq(0)
    expect(result.skipped).to eq(1)
    expect(BoardObject.exists?(frame.id)).to be(true)
    expect(child.reload.parent_frame_id).to eq(frame.id)
  end

  it "削除対象同士の親子関係は両方まとめて削除できる" do
    frame = create_object(deleted_at: nil, code: "frame")
    child = create_object(deleted_at: nil, parent_frame: frame)
    [ frame, child ].each { |o| o.update_column(:deleted_at, retention.ago - 1.day) }

    result = described_class.new.call

    expect(result.purged).to eq(2)
    expect(BoardObject.where(id: [ frame.id, child.id ])).to be_empty
  end

  # 保守バッチが走るたびにボード一覧の並び順が変わってはいけない。
  it "ボードの updated_at を更新しない" do
    create_object(deleted_at: retention.ago - 1.day)
    board.update!(updated_at: 10.days.ago)
    before_updated_at = board.reload.updated_at

    described_class.new.call

    expect(board.reload.updated_at).to be_within(1.second).of(before_updated_at)
  end

  it "dry_run では件数を返すだけで削除しない" do
    expired = create_object(deleted_at: retention.ago - 1.day)

    result = described_class.new.call(dry_run: true)

    expect(result.purged).to eq(1)
    expect(BoardObject.exists?(expired.id)).to be(true)
  end

  it "対象が無いときは何もせず 0 件を返す" do
    create_object(deleted_at: nil)

    result = described_class.new.call

    expect(result.purged).to eq(0)
    expect(result.skipped).to eq(0)
  end
end
