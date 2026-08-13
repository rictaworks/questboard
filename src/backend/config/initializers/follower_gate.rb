target_account_id = ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"].to_s.strip
manual_recheck_cooldown_minutes = ENV.fetch("X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES", "15").to_s.strip

if target_account_id.empty?
  raise StandardError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID is required and must be non-empty."
end

unless target_account_id.match?(/\A\d+\z/)
  raise StandardError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID must be a numeric ID."
end

unless manual_recheck_cooldown_minutes.match?(/\A[1-9]\d*\z/)
  raise StandardError, "X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES must be a positive integer."
end

bypass_ids_raw = ENV.fetch("X_FOLLOWER_GATE_BYPASS_USER_IDS", "").to_s.strip
bypass_ids = bypass_ids_raw.split(",").map(&:strip).reject(&:empty?).to_set

Rails.configuration.x.follower_gate_target_account_id = target_account_id
Rails.configuration.x.follower_gate_bypass_user_ids = bypass_ids
Rails.configuration.x.follower_gate_manual_recheck_cooldown_minutes = manual_recheck_cooldown_minutes.to_i
