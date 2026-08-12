module Auth
  class FollowerCacheSyncJob < ApplicationJob
    queue_as :default

    def perform
      FollowerCacheSync.new.call
    end
  end
end
