Rails.application.routes.draw do
  get "/healthz", to: "health#show"
  post "/client_errors", to: "client_errors#create"

  # 開発専用のセッション発行。本番では routes.rb でルート自体を定義しないことに加え、
  # app/controllers/dev/ を .dockerignore で本番イメージから物理的に除外している
  # （見せかけの認証バイパス questboard/src/components/auth-panel.tsx と対）。
  unless Rails.env.production?
    namespace :dev do
      post "/session", to: "session#create"
    end
  end

  namespace :admin do
    root to: "dashboard#show"
    resources :users, only: [ :index, :create ] do
      member do
        patch :toggle_bypass
      end
    end
  end

  namespace :auth do
    post "/x_sessions", to: "x_sessions#create"
  end

  resource :user_settings, only: %i[show update]
  resources :kpi_events, only: :create
  resources :boards, only: %i[index create]
  get "/boards/:share_token", to: "boards#show"
  delete "/boards/:share_token", to: "boards#destroy"
  post "/boards/:share_token/join", to: "boards#join"
  patch "/boards/:share_token/members/:user_id", to: "boards#update_member_role"
  post "/boards/:share_token/objects", to: "objects#create"
  patch "/boards/:share_token/objects/:id/move", to: "objects#move"
  patch "/boards/:share_token/objects/:id/resize", to: "objects#resize"
  patch "/boards/:share_token/objects/:id/rotate", to: "objects#rotate"
  post "/boards/:share_token/objects/:id/duplicate", to: "objects#duplicate"
  patch "/boards/:share_token/objects/:id/color", to: "objects#recolor"
  patch "/boards/:share_token/objects/:id/shape", to: "objects#reshape"
  post "/boards/:share_token/objects/:id/lock", to: "objects#lock"
  delete "/boards/:share_token/objects/:id/lock", to: "objects#unlock"
  post "/boards/:share_token/objects/:id/ops", to: "objects#apply_op"
  delete "/boards/:share_token/objects/:id", to: "objects#destroy"
  get "/boards/:share_token/objects/:object_id/comments", to: "comments#index"
  post "/boards/:share_token/objects/:object_id/comments", to: "comments#create"
  patch "/boards/:share_token/objects/:object_id/comments/:id", to: "comments#update"
  delete "/boards/:share_token/objects/:object_id/comments/:id", to: "comments#destroy"

  resources :quests, only: :index do
    member do
      post :skip
      post :reopen
      post :claim
    end
  end

  resource :session, controller: "session", only: %i[show destroy]
  post "/session/recheck", to: "session#recheck"
end
