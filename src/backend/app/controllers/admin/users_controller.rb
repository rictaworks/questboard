module Admin
  class UsersController < BaseController
    def index
      load_index_data
    end

    def create
      x_user_id = params[:x_user_id].to_s.strip
      display_name = params[:display_name].to_s.strip

      if x_user_id.empty? || display_name.empty?
        return render_index_with_alert(I18n.t("admin.users.create.params_missing"))
      end

      member_plan = Plan.find_or_create_by_code!("member")
      user = User.find_or_initialize_by(x_user_id: x_user_id)
      user.display_name = display_name
      user.plan = member_plan
      user.is_manual_member = true

      unless user.save
        return render_index_with_alert(I18n.t("admin.users.create.failure"))
      end

      # 成功時はリダイレクトする（POST-Redirect-Get）。再読み込みでの二重送信を防ぐため。
      # ここで flash が失われても、一覧に追加されたユーザーが見えるので結果は伝わる。
      flash[:notice] = I18n.t("admin.users.create.success")
      redirect_to admin_users_path
    end

    def toggle_bypass
      user = User.find(params[:id])
      member_plan = Plan.find_or_create_by_code!("member")

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

    private

    # 入力エラーはリダイレクトせず、その場で一覧を描画してメッセージを出す。
    #
    # セッションは `_questboard_session` ひとつで `domain: questboard.rictaworks.jp`
    # （config/application.rb）。フロントは credentials:'include' で api.questboard... を叩き、
    # backend は同じ cookie に session[:user_id] を保存するため、**管理画面の flash と
    # 一般ユーザーのログインセッションが同一 cookie を共有している**。管理者のブラウザで
    # フロントを同時に開いていると、POST とリダイレクト後の GET の間に走ったフロントの
    # API 呼び出しが Set-Cookie でセッションを上書きし、flash だけが消える（issue #187）。
    #
    # flash.now はセッションに書かないので、cookie が誰にどう上書きされても影響を受けない。
    def render_index_with_alert(message)
      flash.now[:alert] = message
      load_index_data

      render :index, status: :unprocessable_content
    end

    def load_index_data
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
      @member_plan = Plan.find_or_create_by_code!("member")
      @none_plan = Plan.find_or_create_by_code!("none")
    end
  end
end
