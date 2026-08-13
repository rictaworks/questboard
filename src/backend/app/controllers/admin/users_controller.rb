module Admin
  class UsersController < BaseController
    def index
      # ユーザーの検索と取得（最大50件）
      @users = User.includes(:plan).order(created_at: :desc)
      if params[:search_user].present?
        q = "%#{params[:search_user].strip}%"
        @users = @users.where("x_user_id = ? OR display_name LIKE ?", params[:search_user].strip, q)
      end
      @users = @users.limit(50)

      # フォロワーキャッシュの検索と取得（最大50件）
      @follower_caches = FollowerCache.order(fetched_at: :desc)
      if params[:search_cache].present?
        @follower_caches = @follower_caches.where(x_user_id: params[:search_cache].strip)
      end
      @follower_caches = @follower_caches.limit(50)

      # 画面表示用にインデックス化（表示する範囲のみに限定してメモリ展開）
      @users_by_x_id = @users.index_by(&:x_user_id)
      @member_plan = Plan.find_by!(code: "member")
      @none_plan = Plan.find_by!(code: "none")
    end

    def create
      x_user_id = params[:x_user_id].to_s.strip
      display_name = params[:display_name].to_s.strip

      if x_user_id.empty? || display_name.empty?
        flash[:alert] = I18n.t("admin.users.create.params_missing")
        redirect_to admin_users_path and return
      end

      member_plan = Plan.find_by!(code: "member")
      user = User.find_or_initialize_by(x_user_id: x_user_id)
      user.display_name = display_name
      user.plan = member_plan
      user.is_manual_member = true

      if user.save
        flash[:notice] = I18n.t("admin.users.create.success")
      else
        flash[:alert] = I18n.t("admin.users.create.failure")
      end

      redirect_to admin_users_path
    end

    def toggle_bypass
      user = User.find(params[:id])
      member_plan = Plan.find_by!(code: "member")

      user.is_manual_member = !user.is_manual_member
      user.plan = if user.is_manual_member
                    member_plan
      else
                    # 解除時は無条件に降格せず、通常のフォロワーゲートロジックからプランを再計算する
                    ::Auth::FollowerGate.new.resolve_plan(user.x_user_id, ignore_db: true)
      end

      if user.save
        flash[:notice] = I18n.t("admin.users.toggle_bypass.success")
      else
        flash[:alert] = I18n.t("admin.users.toggle_bypass.failure")
      end

      redirect_to admin_users_path
    end
  end
end
