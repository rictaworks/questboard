require "rails_helper"

RSpec.describe RadialMenuBuilder do
  subject(:builder) { described_class.new }

  before do
    RadialMenuItem.create!(code: "create_sticky", label: "付箋を作成", sort_order: 1)
    RadialMenuItem.create!(code: "create_shape", label: "図形を作成", sort_order: 2)
    RadialMenuItem.create!(code: "create_text", label: "テキストを作成", sort_order: 3)
    RadialMenuItem.create!(code: "create_frame", label: "フレームを作成", sort_order: 4)
    RadialMenuItem.create!(code: "duplicate", label: "複製", sort_order: 5)
    RadialMenuItem.create!(code: "delete", label: "削除", sort_order: 6)
    RadialMenuItem.create!(code: "lock", label: "ロック", sort_order: 7)
    RadialMenuItem.create!(code: "unlock", label: "ロック解除", sort_order: 8)
    RadialMenuItem.create!(code: "comment", label: "コメント", sort_order: 9)
    RadialMenuItem.create!(code: "align", label: "整列", sort_order: 10)
    RadialMenuItem.create!(code: "group", label: "グループ化", sort_order: 11)
    RadialMenuItem.create!(code: "ungroup", label: "グループ解除", sort_order: 12)
    RadialMenuItem.create!(code: "recolor", label: "色を変更", sort_order: 13)
    RadialMenuItem.create!(code: "share", label: "共有", sort_order: 14)
  end

  it "covers the 7 target × 4 role × 3 selection matrix" do
    targets = %i[blank sticky shape text connector image frame]
    roles = %i[owner editor commenter viewer]
    selection_counts = [ 0, 1, 2 ]

    targets.product(roles, selection_counts).each do |target_kind, role, selection_count|
      result = builder.build(
        target_kind:,
        selection_count:,
        role:,
        usage_stats: { duplicate: 10, delete: 9, comment: 8, align: 7, group: 6, ungroup: 5, recolor: 4, share: 3, create_sticky: 2, create_shape: 1 }
      )

      expect(result[:center]).to eq(code: :cancel, label: "キャンセル")

      if role == :viewer
        expect(result[:visible]).to be(false)
        expect(result[:items]).to be_empty
        next
      end

      codes = result[:items].map { |item| item[:code] }

      if codes.empty?
        expect(result[:visible]).to be(false)
        expect(result[:rings]).to be_empty
        next
      end

      if selection_count > 1
        expect(codes).to all(satisfy { |code| RadialMenuBuilder::COMMON_ACTION_CODES.include?(code) })
      elsif role == :commenter
        expect(codes).to all(satisfy { |code| code == :comment })
      elsif target_kind == :blank
        expect(codes).to all(satisfy { |code| RadialMenuBuilder::BLANK_ACTION_CODES.include?(code) })
      else
        expect(codes).to all(satisfy { |code| RadialMenuBuilder::TARGET_ACTION_CODES.fetch(target_kind, []).include?(code) })
      end

      if result[:items].size > 8
        expect(result[:rings].first.size).to eq(8)
        expect(result[:rings].size).to eq(2)
      else
        expect(result[:rings].size).to eq(1)
      end
      expect(result[:items].each_cons(2).all? { |left, right| left[:frequency] >= right[:frequency] }).to be(true)
    end
  end

  it "filters multiple selection to common actions and keeps them in frequency order" do
    result = builder.build(
      target_kind: :shape,
      selection_count: 3,
      role: :editor,
      usage_stats: { delete: 4, duplicate: 9, align: 2, group: 1 }
    )

    expect(result[:items].map { |item| item[:code] }).to eq(%i[duplicate delete align group])
    expect(result[:rings].first.map { |item| item.slice(:code, :ring, :slot) }).to eq([
      { code: :duplicate, ring: 1, slot: 1 },
      { code: :delete, ring: 1, slot: 2 },
      { code: :align, ring: 1, slot: 3 },
      { code: :group, ring: 1, slot: 4 }
    ])
  end

  it "splits nine or more items across two rings" do
    result = builder.build(
      target_kind: :frame,
      selection_count: 1,
      role: :owner,
      usage_stats: {
        duplicate: 14,
        delete: 13,
        comment: 12,
        share: 11,
        lock: 10,
        unlock: 9,
        recolor: 8,
        align: 7,
        group: 6,
        create_sticky: 5,
        create_shape: 4,
        create_text: 3,
        create_frame: 2,
        ungroup: 1
      },
      target_state: { locked: false }
    )

    expect(result[:items].size).to be >= 9
    expect(result[:rings].first.size).to eq(8)
    expect(result[:rings].last.size).to eq(result[:items].size - 8)
    expect(result[:items].first[:code]).to eq(:duplicate)
    expect(result[:items].last[:code]).to eq(:ungroup)
  end

  it "switches between lock and unlock using target state" do
    unlocked = builder.build(target_kind: :frame, selection_count: 1, role: :editor, target_state: { locked: false })
    locked = builder.build(target_kind: :frame, selection_count: 1, role: :editor, target_state: { locked: true, actor_id: 1, lock_owner_id: 1 })

    expect(unlocked[:items].map { |item| item[:code] }).to include(:lock)
    expect(unlocked[:items].map { |item| item[:code] }).not_to include(:unlock)
    expect(locked[:items].map { |item| item[:code] }).to include(:unlock)
    expect(locked[:items].map { |item| item[:code] }).not_to include(:lock)
  end

  it "returns empty menu and visible false for unknown target kinds" do
    unknown_kind = builder.build(target_kind: :unknown, selection_count: 1, role: :editor)
    nil_kind = builder.build(target_kind: nil, selection_count: 1, role: :editor)

    expect(unknown_kind[:visible]).to be(false)
    expect(unknown_kind[:items]).to be_empty
    expect(nil_kind[:visible]).to be(false)
    expect(nil_kind[:items]).to be_empty
  end

  it "omits comment action from blank canvas menu" do
    result = builder.build(target_kind: :blank, selection_count: 0, role: :commenter)

    expect(result[:visible]).to be(false)
    expect(result[:items].map { |item| item[:code] }).not_to include(:comment)
  end
end
