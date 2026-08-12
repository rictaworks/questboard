require "set"

module Auth
  class FollowerCacheSync
    Result = Struct.new(:added_count, :removed_count, :confirmed_count, keyword_init: true)

    def initialize(
      client: XFollowersClient.new,
      follower_cache: FollowerCache,
      user_model: User,
      member_plan_code: "member",
      none_plan_code: "none",
      target_account_id: Rails.configuration.x.follower_gate_target_account_id,
      page_size: Rails.configuration.x.follower_cache_sync_page_size
    )
      @client = client
      @follower_cache = follower_cache
      @user_model = user_model
      @member_plan_code = member_plan_code
      @none_plan_code = none_plan_code
      @target_account_id = target_account_id
      @page_size = page_size
    end

    def call
      ids, cycle_error = fetch_follower_ids
      raise cycle_error if cycle_error

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

      loop do
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
        pagination_token = page.next_token
        break if pagination_token.blank?
      end

      [ ids.uniq, cycle_error ]
    end

    def synchronize!(current_ids)
      current_ids = current_ids.to_a.uniq
      current_ids_set = current_ids.to_set

      now = Time.current
      member_plan_id = Plan.find_by!(code: member_plan_code).id
      none_plan_id = Plan.find_by!(code: none_plan_code).id

      added_count = 0
      removed_count = 0
      confirmed_count = 0

      follower_cache.transaction do
        existing_ids = follower_cache.pluck(:x_user_id)
        existing_ids_set = existing_ids.to_set
        added_ids = current_ids_set - existing_ids_set
        removed_ids = existing_ids_set - current_ids_set

        follower_cache.where(x_user_id: current_ids).update_all(fetched_at: now) if current_ids.any?
        follower_cache.insert_all(added_ids.map { |x_user_id| { x_user_id:, fetched_at: now } }) if added_ids.any?
        follower_cache.where(x_user_id: removed_ids.to_a).delete_all if removed_ids.any?
        user_model.where(x_user_id: current_ids).update_all(plan_id: member_plan_id) if current_ids.any?
        user_model.where(x_user_id: removed_ids.to_a).update_all(plan_id: none_plan_id) if removed_ids.any?

        added_count = added_ids.size
        removed_count = removed_ids.size
        confirmed_count = current_ids.size
      end

      Result.new(
        added_count: added_count,
        removed_count: removed_count,
        confirmed_count: confirmed_count
      )
    end
  end
end
