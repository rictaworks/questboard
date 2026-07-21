Rails.application.routes.draw do
  get "/healthz", to: "health#show"

  namespace :admin do
    root to: "dashboard#show"
  end

  namespace :auth do
    post "/google_sessions", to: "google_sessions#create"
  end

  resources :boards, only: :create
  post "/boards/:share_token/join", to: "boards#join"
  patch "/boards/:share_token/members/:user_id", to: "boards#update_member_role"
  post "/boards/:share_token/objects", to: "objects#create"
  patch "/boards/:share_token/objects/:id/move", to: "objects#move"
  patch "/boards/:share_token/objects/:id/resize", to: "objects#resize"
  patch "/boards/:share_token/objects/:id/rotate", to: "objects#rotate"
  post "/boards/:share_token/objects/:id/lock", to: "objects#lock"
  delete "/boards/:share_token/objects/:id/lock", to: "objects#unlock"
  delete "/boards/:share_token/objects/:id", to: "objects#destroy"

  resource :session, controller: "session", only: %i[show destroy]
end
