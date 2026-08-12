target_account_id = ENV["X_FOLLOWER_GATE_TARGET_ACCOUNT_ID"].to_s.strip

if target_account_id.empty?
  raise StandardError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID is required and must be non-empty."
end

unless target_account_id.match?(/\A\d+\z/)
  raise StandardError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID must be a numeric ID."
end

Rails.configuration.x.follower_gate_target_account_id = target_account_id
