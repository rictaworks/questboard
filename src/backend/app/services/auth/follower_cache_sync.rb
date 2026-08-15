require "set"

module Auth
  class FollowerCacheSync
    Result = Struct.new(:added_count, :removed_count, :confirmed_count, keyword_init: true)

    MAX_PAGES_LIMIT = 100
    INCREMENTAL_SYNC_PAGE_SIZE = 10

    def initialize(
      client: XFollowersClient.new,
      follower_cache: FollowerCache,
      user_model: User,
      member_plan_code: "member",
      none_plan_code: "none",
      target_account_id: Rails.configuration.x.follower_gate_target_account_id,
      page_size: Rails.configuration.x.follower_cache_sync_page_size,
      full_sync: false
    )
      @client = client
      @follower_cache = follower_cache
      @user_model = user_model
      @member_plan_code = member_plan_code
      @none_plan_code = none_plan_code
      @target_account_id = target_account_id
      @full_sync = full_sync || follower_cache.count.zero?
      @page_size = @full_sync ? page_size : INCREMENTAL_SYNC_PAGE_SIZE
    end

    def call
      ids, cycle_error = fetch_follower_ids
      if cycle_error
        if @full_sync
          raise cycle_error
        else
          Rails.logger.warn("[Auth::FollowerCacheSync] Token cycle or page limit exceeded during incremental sync. Continuing with partial results to prevent mass demotion.")
        end
      end

      synchronize!(ids)
    rescue XFollowersClient::Error => e
      Rails.logger.error("[Auth::FollowerCacheSync] #{e.class}: #{e.message}")
      raise
    end

    private

    attr_reader :client, :follower_cache, :user_model, :member_plan_code, :none_plan_code, :target_account_id, :page_size

    def fetch_follower_ids
      ids = []
      pagination_token = nil
      seen_tokens = Set.new
      cycle_error = nil
      request_count = 0

      existing_set = @full_sync ? Set.new : follower_cache.pluck(:x_user_id).to_set

      loop do
        request_count += 1
        if request_count > MAX_PAGES_LIMIT
          cycle_error = XFollowersClient::RequestError.new("Max pages limit exceeded (#{MAX_PAGES_LIMIT} pages). Aborting to prevent infinite loop API charges.")
          break
        end

        if pagination_token.present? && seen_tokens.include?(pagination_token)
          cycle_error = XFollowersClient::RequestError.new("Pagination token cycle detected: #{pagination_token}")
          break
        end
        seen_tokens.add(pagination_token) if pagination_token.present?

        page = client.fetch_followers_page(
          user_id: target_account_id,
          max_results: page_size,
          pagination_token: pagination_token
        )

        ids.concat(page.ids)

        if !@full_sync && page.ids.any? { |id| existing_set.include?(id) }
          break
        end

        pagination_token = page.next_token
        break if pagination_token.blank?
      end

      [ ids.uniq, cycle_error ]
    end

    def synchronize!(current_ids)
      current_ids = current_ids.to_a.uniq
      current_ids_set = current_ids.to_set

      now = Time.current
      member_plan_id = Plan.find_or_create_by_code!(member_plan_code).id
      none_plan_id = Plan.find_or_create_by_code!(none_plan_code).id

      added_count = 0
      removed_count = 0
      confirmed_count = 0

      follower_cache.transaction do
        if @full_sync
          existing_ids = follower_cache.pluck(:x_user_id)
          existing_ids_set = existing_ids.to_set
          added_ids = current_ids_set - existing_ids_set
          removed_ids = existing_ids_set - current_ids_set

          bypass_set = Rails.configuration.x.follower_gate_bypass_user_ids || Set.new
          manual_db_set = user_model.where(is_manual_member: true).pluck(:x_user_id).to_set
          demote_ids = removed_ids.to_a.reject do |id|
            bypass_set.include?(id.to_s) || manual_db_set.include?(id.to_s)
          end

          follower_cache.where(x_user_id: current_ids).update_all(fetched_at: now) if current_ids.any?
          follower_cache.insert_all(added_ids.map { |x_user_id| { x_user_id:, fetched_at: now } }) if added_ids.any?
          follower_cache.where(x_user_id: removed_ids.to_a).delete_all if removed_ids.any?
          user_model.where(x_user_id: current_ids).update_all(plan_id: member_plan_id) if current_ids.any?
          user_model.where(x_user_id: demote_ids).update_all(plan_id: none_plan_id) if demote_ids.any?

          added_count = added_ids.size
          removed_count = removed_ids.size
          confirmed_count = current_ids.size
        else
          existing_ids = follower_cache.where(x_user_id: current_ids).pluck(:x_user_id).to_set
          added_ids = current_ids_set - existing_ids

          follower_cache.where(x_user_id: existing_ids.to_a).update_all(fetched_at: now) if existing_ids.any?
          follower_cache.insert_all(added_ids.map { |x_user_id| { x_user_id:, fetched_at: now } }) if added_ids.any?
          user_model.where(x_user_id: current_ids).update_all(plan_id: member_plan_id) if current_ids.any?

          added_count = added_ids.size
          removed_count = 0
          confirmed_count = current_ids.size
        end
      end

      Result.new(
        added_count: added_count,
        removed_count: removed_count,
        confirmed_count: confirmed_count
      )
    end
  end
end
