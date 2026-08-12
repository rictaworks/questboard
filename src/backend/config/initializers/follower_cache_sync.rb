interval_minutes = ENV.fetch("X_FOLLOWER_CACHE_SYNC_INTERVAL_MINUTES", "60").to_s.strip
page_size = ENV.fetch("X_FOLLOWER_CACHE_SYNC_PAGE_SIZE", "100").to_s.strip
bearer_token = ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"].to_s.strip

unless interval_minutes.match?(/\A[1-9]\d*\z/)
  raise StandardError, "X_FOLLOWER_CACHE_SYNC_INTERVAL_MINUTES must be a positive integer."
end

unless page_size.match?(/\A[1-9]\d*\z/)
  raise StandardError, "X_FOLLOWER_CACHE_SYNC_PAGE_SIZE must be a positive integer."
end

if bearer_token.empty?
  raise StandardError, "X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN is required and must be non-empty."
end

Rails.configuration.x.follower_cache_sync_interval_minutes = interval_minutes.to_i
Rails.configuration.x.follower_cache_sync_page_size = page_size.to_i
Rails.configuration.x.follower_cache_sync_bearer_token = bearer_token
