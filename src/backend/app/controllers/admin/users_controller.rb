module Admin
  class UsersController < BaseController
    # 利用者の一覧のみを扱う（Issue #253）。
    #
    # **手動ログイン許可（例外指定）はここでは行わない。** 救済は判定サービス
    # （x-follower-gate）のオーバーライドへ一本化した。questboard 側にも例外経路を残すと、
    # 運用者がどちらを見ればよいか分からなくなり、判定が2か所へ戻る。
    def index
      load_index_data
    end

    private

    def load_index_data
      # ユーザーの検索と取得（最大50件）
      @users = User.includes(:plan).order(created_at: :desc)
      if params[:search_user].present?
        q = "%#{params[:search_user].strip}%"
        @users = @users.where("x_user_id = ? OR display_name LIKE ?", params[:search_user].strip, q)
      end
      @users = @users.limit(50)

      @member_plan = Plan.find_or_create_by_code!("member")
      @none_plan = Plan.find_or_create_by_code!("none")
    end
  end
end
