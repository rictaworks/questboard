module Auth
  # フォロワー判定サービス（x-follower-gate）の判定を questboard のプラン値へ写す（Issue #253）。
  #
  # **判定そのものはここで行わない。** フォロワーキャッシュも X API も参照しない。
  # 例外的な許可（手動メンバー指定・バイパス指定）も持たない。救済は判定サービス側の
  # オーバーライドへ一本化しており、questboard 側に例外経路を残すと判定が2か所へ戻る。
  class FollowerGate
    MEMBER_PLAN_CODE = "member"
    NONE_PLAN_CODE = "none"

    # 判定サービスのプラン値（full / restricted）と questboard のプラン値（member / none）は
    # 別の語彙なので、境界で写す。questboard 側のコードを判定サービスへ合わせて変えると
    # ApplicationController#require_feature_plan! と既存の plans / users に手が入る。
    PLAN_CODE_BY_GATE_PLAN = {
      FollowerGateClient::PLAN_FULL => MEMBER_PLAN_CODE,
      FollowerGateClient::PLAN_RESTRICTED => NONE_PLAN_CODE
    }.freeze

    # 判定の結果と、拒否画面へ出す照会用IDをまとめて返す。
    # プラン値だけを返すと、拒否された利用者が運用者へ申告する値を画面に出せない。
    Resolution = Struct.new(:plan, :inquiry_id, :recheck_available, :confirmed, keyword_init: true)

    def initialize(client: FollowerGateClient.new)
      @client = client
    end

    def resolve(x_user_id)
      decision = client.fetch_decision(x_user_id)

      Resolution.new(
        plan: Plan.find_or_create_by_code!(plan_code_for(decision.plan)),
        inquiry_id: decision.inquiry_id,
        recheck_available: decision.recheck_available,
        confirmed: decision.confirmed
      )
    end

    private

    attr_reader :client

    def plan_code_for(gate_plan)
      # FollowerGateClient が想定外のプラン値を弾いているため、ここへ来る値は必ず対応表にある。
      # 万一漏れた場合に none へ倒すと拒否として扱われるので、明示的に失敗させる。
      PLAN_CODE_BY_GATE_PLAN.fetch(gate_plan)
    end
  end
end
