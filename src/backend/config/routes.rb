Rails.application.routes.draw do
  get "/healthz", to: "health#show"

  namespace :admin do
    root to: "dashboard#show"
  end
end
