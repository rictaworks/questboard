page_size = ENV.fetch("X_FOLLOWER_CACHE_SYNC_PAGE_SIZE", "100").to_s.strip
bearer_token = ENV["X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN"].to_s.strip

unless page_size.match?(/\A[1-9]\d*\z/)
  raise StandardError, "X_FOLLOWER_CACHE_SYNC_PAGE_SIZE must be a positive integer."
end

if bearer_token.empty?
  raise StandardError, "X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN is required and must be non-empty."
end

Rails.configuration.x.follower_cache_sync_page_size = page_size.to_i
Rails.configuration.x.follower_cache_sync_bearer_token = bearer_token
