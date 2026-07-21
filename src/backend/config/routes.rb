Rails.application.routes.draw do
  get "/healthz", to: "health#show"

  namespace :admin do
    root to: "dashboard#show"
  end

  namespace :auth do
    post "/google_sessions", to: "google_sessions#create"
  end

  resource :session, controller: "session", only: %i[show destroy]
end
