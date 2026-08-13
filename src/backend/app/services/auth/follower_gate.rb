module Auth
  class FollowerGate
    class ConfigurationError < StandardError; end

    MEMBER_PLAN_CODE = "member"
    NONE_PLAN_CODE = "none"

    def initialize(
      follower_cache: FollowerCache,
      target_account_id: Rails.configuration.x.follower_gate_target_account_id,
      bypass_user_ids: Rails.configuration.x.follower_gate_bypass_user_ids,
      member_plan_code: MEMBER_PLAN_CODE,
      none_plan_code: NONE_PLAN_CODE
    )
      @follower_cache = follower_cache
      @target_account_id = target_account_id.to_s.strip
      @bypass_user_ids = bypass_user_ids || Set.new
      @member_plan_code = member_plan_code
      @none_plan_code = none_plan_code

      raise ConfigurationError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID is required" if @target_account_id.empty?
      raise ConfigurationError, "X_FOLLOWER_GATE_TARGET_ACCOUNT_ID must be numeric" unless @target_account_id.match?(/\A\d+\z/)
    end

    def resolve_plan(x_user_id, ignore_db: false)
      user = ignore_db ? nil : User.find_by(x_user_id: x_user_id.to_s)
      plan_code = if @bypass_user_ids.include?(x_user_id.to_s)
                    member_plan_code
      elsif user&.is_manual_member?
                    member_plan_code
      elsif follower_cache.exists?(x_user_id:)
                    member_plan_code
      else
                    none_plan_code
      end
      Plan.find_by!(code: plan_code)
    end

    private

    attr_reader :follower_cache, :target_account_id, :member_plan_code, :none_plan_code
  end
end
