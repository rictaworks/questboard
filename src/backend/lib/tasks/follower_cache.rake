namespace :auth do
  desc "Synchronize the follower cache with X"
  task sync_follower_cache: :environment do
    Auth::FollowerCacheSyncJob.perform_now
  end
end
