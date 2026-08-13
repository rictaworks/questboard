module Auth
  class FollowerCacheSyncJob < ApplicationJob
    queue_as :default

    def perform(full_sync: false)
      FollowerCacheSync.new(full_sync: full_sync).call
    end
  end
end
