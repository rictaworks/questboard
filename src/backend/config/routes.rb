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

  resource :session, controller: "session", only: %i[show destroy]
end
