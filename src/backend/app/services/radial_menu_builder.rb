class RadialMenuUsageStats
  def initialize(counts = {})
    @counts = normalize_counts(counts)
  end

  def frequency_for(code)
    @counts.fetch(code.to_s, 0).to_i
  end

  private

  def normalize_counts(counts)
    (counts || {}).each_with_object({}) do |(key, value), memo|
      memo[key.to_s] = value.to_i
    end
  end
end

class RadialMenuBuilder
  COMMON_ACTION_CODES = %i[align group duplicate delete].freeze
  BLANK_ACTION_CODES = %i[create_sticky create_shape create_text create_frame comment share].freeze
  TARGET_ACTION_CODES = {
    sticky: %i[duplicate delete comment recolor share],
    shape: %i[duplicate delete comment recolor share],
    text: %i[duplicate delete comment recolor share],
    connector: %i[duplicate delete comment share],
    image: %i[duplicate delete comment recolor share],
    frame: %i[duplicate delete comment recolor lock unlock align group ungroup share]
  }.freeze

  def initialize(permission_service: PermissionService.new, menu_items: RadialMenuItem.ordered)
    @permission_service = permission_service
    @menu_items = menu_items
  end

  def build(target_kind:, selection_count:, role:, usage_stats: nil, target_state: {})
    normalized_role = normalize_role(role)
    normalized_target_kind = normalize_target_kind(target_kind)
    normalized_selection_count = selection_count.to_i
    normalized_target_state = normalize_target_state(target_state)

    center = {code: :cancel, label: "キャンセル"}

    return {visible: false, center:, rings: [], items: []} if normalized_role == :viewer

    candidate_codes = candidate_codes_for(
      target_kind: normalized_target_kind,
      selection_count: normalized_selection_count
    )
    executable_codes = filter_executable_codes(candidate_codes, normalized_role, normalized_target_state)
    usage_stats = normalize_usage_stats(usage_stats)
    ordered_items = rank_items(executable_codes, usage_stats)

    return {visible: false, center:, rings: [], items: []} if ordered_items.empty?

    rings = ordered_items.each_slice(8).map.with_index(1) do |slice, ring_index|
      slice.map.with_index(1) do |item, slot_index|
        item.merge(ring: ring_index, slot: slot_index)
      end
    end

    {
      visible: true,
      center:,
      rings:,
      items: rings.flatten
    }
  end
  alias build_radial_items build

  private

  attr_reader :permission_service, :menu_items

  def normalize_role(role)
    role.to_s.strip.downcase.to_sym
  end

  def normalize_target_kind(target_kind)
    target_kind.to_s.strip.downcase.to_sym
  end

  def normalize_target_state(target_state)
    (target_state || {}).each_with_object({}) do |(key, value), memo|
      memo[key.to_s.strip.downcase.to_sym] = value
    end
  end

  def normalize_usage_stats(usage_stats)
    return usage_stats if usage_stats.respond_to?(:frequency_for)

    RadialMenuUsageStats.new(usage_stats)
  end

  def candidate_codes_for(target_kind:, selection_count:)
    return COMMON_ACTION_CODES if selection_count > 1

    if target_kind == :blank
      return BLANK_ACTION_CODES
    end

    TARGET_ACTION_CODES.fetch(target_kind, TARGET_ACTION_CODES[:shape])
  end

  def filter_executable_codes(codes, role, target_state)
    codes.select do |code|
      permission_service.authorize(role, code, target_state)
    end
  end

  def rank_items(codes, usage_stats)
    items = menu_items.index_by { |item| item.code.to_sym }

    codes.filter_map do |code|
      menu_item = items[code]
      next unless menu_item

      {
        code: code,
        label: menu_item.label,
        sort_order: menu_item.sort_order,
        frequency: usage_stats.frequency_for(code)
      }
    end.sort_by do |item|
      [-item[:frequency], item[:sort_order], item[:code].to_s]
    end
  end
end
