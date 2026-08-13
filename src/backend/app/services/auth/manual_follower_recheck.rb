require "set"

module Auth
  class ManualFollowerRecheck
    class CooldownError < StandardError
      attr_reader :remaining_seconds

      def initialize(remaining_seconds:)
        @remaining_seconds = remaining_seconds
        super("manual follower recheck cooldown is still active")
      end
    end

    # 手動再判定は増分取得なので、通常は1〜2ページで打ち切られる（自分が見つかるか、
    # 既知のキャッシュ済みIDに到達する）。キャッシュが空で後者が効かない場合に備えた
    # 頭打ちであり、認証済み利用者がボタン1回で消費できるリクエスト数の上限そのもの
    # でもあるため、全件同期用の Auth::FollowerCacheSync::MAX_PAGES_LIMIT より小さくする。
    # 上限に達した場合はフォロワーと確認できず none 据え置き（fail-closed）となる。
    MAX_PAGES_LIMIT = 5

    def initialize(
      user:,
      # 再判定は利用者のHTTPリクエストを処理しているスレッド上で同期実行される。
      # 既定の再試行（最大3回）は 429 のたびに x-rate-limit-reset まで sleep するため、
      # X のレート制限窓（最大15分）ぶんワーカースレッドを占有する。クールダウンは
      # 利用者ごとの制限であり、別々の利用者による同時押下は抑止できないので、
      # この経路では再試行せず失敗として返し、502（api.errors.x_followers_unavailable）に倒す。
      client: XFollowersClient.new(max_retries: 0),
      follower_cache: FollowerCache,
      follower_gate: FollowerGate.new,
      target_account_id: Rails.configuration.x.follower_gate_target_account_id,
      # 手動再判定は「フォロー直後の取りこぼしを救済する」差分取得であり、全件同期ではない。
      # フルシンク用の page_size を流用すると1回のボタン押下で大量のIDを引くことになるため、
      # Auth::FollowerCacheSync の増分同期と同じページサイズを既定とする。
      page_size: FollowerCacheSync::INCREMENTAL_SYNC_PAGE_SIZE,
      cooldown_minutes: Rails.configuration.x.follower_gate_manual_recheck_cooldown_minutes
    )
      @user = user
      @client = client
      @follower_cache = follower_cache
      @follower_gate = follower_gate
      @target_account_id = target_account_id
      @page_size = page_size
      @cooldown_minutes = cooldown_minutes
    end

    def call
      user.with_lock do
        if cooldown_active?
          raise CooldownError.new(remaining_seconds: remaining_seconds_until_allowed)
        end

        # 先に試行時刻を記録してコミットする（API成否に関わらずクールダウンを適用するため）
        user.update!(manual_rechecked_at: Time.current)
      end

      previous_plan_code = user.plan&.code
      current_ids, pages_consumed = fetch_current_follower_ids
      added_count = synchronize_cache!(current_ids)

      resolved_plan = follower_gate.resolve_plan(user.x_user_id)
      user.update!(plan: resolved_plan)

      # プラン値はアクセス制御の根拠（ApplicationController#require_feature_plan!）であり、
      # 誰がいつ変えたか、その際X APIを何ページ消費したかは監査・調査の対象になる。
      Rails.logger.info(
        "[#{self.class.name}] x_user_id=#{user.x_user_id} pages=#{pages_consumed} " \
        "fetched=#{current_ids.size} cache_added=#{added_count} " \
        "plan: #{previous_plan_code} -> #{resolved_plan.code}"
      )

      user.reload
    end

    private

    attr_reader :user, :client, :follower_cache, :follower_gate, :target_account_id, :page_size, :cooldown_minutes

    def cooldown_active?
      user.manual_rechecked_at.present? && remaining_seconds_until_allowed.positive?
    end

    def remaining_seconds_until_allowed
      return 0 unless user.manual_rechecked_at

      expires_at = user.manual_rechecked_at + cooldown_minutes.minutes
      [ (expires_at - Time.current).ceil, 0 ].max
    end

    # フォロワー一覧は新しい順に返るため、フォローしたばかりの利用者は先頭ページに現れる。
    # そこで (1) 自分が見つかった (2) キャッシュ済みの既知IDに到達した のいずれかで打ち切る。
    # (2) が無いと、手動再判定を押すのは定義上フォロワー一覧に居ない plan=none の利用者で
    # あるため、正常系がそのまま全ページ走査となり、クールダウンで守ろうとしている
    # X APIのレート制限・従量課金をボタン1回で消費してしまう。
    def fetch_current_follower_ids
      ids = []
      pagination_token = nil
      seen_tokens = Set.new
      request_count = 0
      target_user_id = user.x_user_id.to_s

      loop do
        request_count += 1
        break if request_count > MAX_PAGES_LIMIT

        if pagination_token.present? && seen_tokens.include?(pagination_token)
          Rails.logger.warn("[Auth::ManualFollowerRecheck] Pagination token cycle detected: #{pagination_token}")
          break
        end

        seen_tokens.add(pagination_token) if pagination_token.present?

        page = client.fetch_followers_page(
          user_id: target_account_id,
          max_results: page_size,
          pagination_token: pagination_token
        )

        ids.concat(page.ids)
        break if page.ids.include?(target_user_id)
        # 既知IDの判定はこのページのID（最大 page_size 件）に絞った索引検索で行う。
        # キャッシュ全件を読み込むと、認証済み利用者が叩けるエンドポイントで
        # フォロワー数に比例したメモリを毎回確保することになるため。
        break if page.ids.any? && follower_cache.where(x_user_id: page.ids).exists?

        pagination_token = page.next_token
        break if pagination_token.blank?
      end

      # 消費ページ数は監査ログに残す。X APIの従量課金・レート制限に直結するため、
      # 「どの再判定がどれだけ使ったか」を後から追えるようにする。
      [ ids.uniq, [ request_count, MAX_PAGES_LIMIT ].min ]
    end

    # 差分取得は先頭ページしか見ないため「一覧に居ない」ことを証明できない。よってここでは
    # 追加と fetched_at の更新のみを行い、キャッシュ行の削除（＝降格）は行わない。
    # member -> none の降格は、全件を走査する定期バッチのフル同期だけが担う
    # （Auth::FollowerCacheSync#synchronize! の full_sync 分岐）。設計書 4.4 / 6.4 も同じ。
    def synchronize_cache!(current_ids)
      now = Time.current
      existing_ids = follower_cache.where(x_user_id: current_ids).pluck(:x_user_id).to_set
      added_ids = current_ids.to_set - existing_ids

      follower_cache.transaction do
        follower_cache.where(x_user_id: existing_ids.to_a).update_all(fetched_at: now) if existing_ids.any?
        # insert_all は ON CONFLICT DO NOTHING を発行するため、既存IDの照会後・書き込み前に
        # 定期バッチが同じIDを入れても重複エラーにはならない。
        follower_cache.insert_all(added_ids.map { |x_user_id| { x_user_id:, fetched_at: now } }) if added_ids.any?
      end

      added_ids.size
    end
  end
end
