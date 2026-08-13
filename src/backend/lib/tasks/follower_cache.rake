namespace :auth do
  desc "Synchronize the follower cache with X"
  task :sync_follower_cache, [ :full_sync ] => :environment do |_, args|
    force_full_sync = args[:full_sync] == "true" || ENV["X_FOLLOWER_CACHE_FULL_SYNC"] == "true"

    full_sync = if force_full_sync
                  true
    elsif FollowerCache.count.zero?
                  true
    else
                  oldest_fetched_at = FollowerCache.minimum(:fetched_at)
                  interval_hours = Rails.configuration.x.follower_cache_full_sync_interval_hours

                  oldest_fetched_at.nil? || oldest_fetched_at < interval_hours.hours.ago
    end

    Auth::FollowerCacheSyncJob.perform_now(full_sync: full_sync)
  end
end
