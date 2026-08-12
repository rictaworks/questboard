module Auth
  class FollowerGate
    class ConfigurationError < StandardError; end

    MEMBER_PLAN_CODE = "member"
    NONE_PLAN_CODE = "none"

    def initialize(
      follower_cache: FollowerCache,
      target_account_id: Rails.configuration.x.follower_gate_target_account_id,
      member_plan_code: MEMBER_PLAN_CODE,
      none_plan_code: NONE_PLAN_CODE
    )
      @follower_cache = follower_cache
      @target_account_id = target_account_id.to_s.strip
      @member_plan_code = member_plan_code
      @none_plan_code = none_plan_code

      raise ConfigurationError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID is required" if @target_account_id.empty?
      raise ConfigurationError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID must be numeric" unless @target_account_id.match?(/\A\d+\z/)
    end

    def resolve_plan(x_user_id)
      plan_code = follower_cache.exists?(x_user_id:) ? member_plan_code : none_plan_code
      Plan.find_by!(code: plan_code)
    end

    private

    attr_reader :follower_cache, :target_account_id, :member_plan_code, :none_plan_code
  end
end
