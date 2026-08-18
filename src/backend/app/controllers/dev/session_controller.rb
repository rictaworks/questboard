module Dev
  # フロントの開発認証バイパス（questboard/src/components/auth-panel.tsx の isDev 分岐）が
  # 実際のセッションCookieを持たずに「認証済み」の見た目だけを出していたため、
  # ボード作成のような書き込み系リクエストは本物のXログインを経ないと常に401になっていた。
  # ここで固定の開発用ユーザーを find_or_create し、本物のセッションを張る。
  #
  # 本番からの二重排除：
  # 1. config/routes.rb で Rails.env.production? のときはこのルート自体を定義しない
  # 2. app/controllers/dev/ 配下は .dockerignore で本番イメージから物理的に除外される
  #    （ルート判定がどこかで壊れても、クラス自体が存在しないので読み込みに失敗する）
  class SessionController < ApplicationController
    DEV_USER_X_ID = "dev-user".freeze

    def create
      plan = Plan.find_or_create_by_code!("member")
      display_name = I18n.t("api.dev_session.display_name")
      user = User.upsert_from_x_identity!(x_user_id: DEV_USER_X_ID, display_name:, plan:)

      session[:user_id] = user.id

      render json: { authenticated: true, user: serialize_user(user) }, status: :created
    end

    private

    def serialize_user(user)
      {
        id: user.id,
        xUserId: user.x_user_id,
        displayName: user.display_name,
        planCode: user.plan&.code
      }
    end
  end
end
