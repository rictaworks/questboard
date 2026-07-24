require "rails_helper"

RSpec.describe BoardObject, type: :model do
  include ActiveSupport::Testing::TimeHelpers

  it "exposes tombstones eligible for purge after 30 days" do
    board = Board.create!(title: "Board")
    object_type = ObjectType.create!(code: "sticky")
    color = ColorPalette.create!(hex: "#FDE68A")
    now = Time.zone.parse("2026-07-24 12:00:00")

    travel_to(now) do
      active_object = described_class.create!(
        board:,
        object_type:,
        color_palette: color,
        geometry: { "x" => 1, "y" => 2, "w" => 3, "h" => 4, "rotation" => 0 },
        text_crdt: {},
        deleted_at: nil
      )
      recent_tombstone = described_class.create!(
        board:,
        object_type:,
        color_palette: color,
        geometry: { "x" => 5, "y" => 6, "w" => 7, "h" => 8, "rotation" => 0 },
        text_crdt: {},
        deleted_at: 29.days.ago
      )
      old_tombstone = described_class.create!(
        board:,
        object_type:,
        color_palette: color,
        geometry: { "x" => 9, "y" => 10, "w" => 11, "h" => 12, "rotation" => 0 },
        text_crdt: {},
        deleted_at: 31.days.ago
      )

      expect(described_class.active).to contain_exactly(active_object)
      expect(described_class.tombstones).to contain_exactly(recent_tombstone, old_tombstone)
      expect(described_class.purgeable_tombstones).to contain_exactly(old_tombstone)
    end
  end
end
