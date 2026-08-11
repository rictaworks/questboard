require "rails_helper"

RSpec.describe "Quests API", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:user) { User.create!(google_sub: "google-sub-quests", display_name: "Quests User") }
  let(:board) { Board.create!(title: "Test Board") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)

    Quest.find_or_create_by!(title: "付箋を3枚作る") do |q|
      q.condition_event = "object_created_sticky"
      q.condition_count = 3
    end

    # 役職の作成とユーザーのボード参加
    role = Role.find_or_create_by!(code: "editor")
    BoardMember.create!(board: board, user: user, role: role)
  end

  def sign_in
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
  end

  describe "GET /quests" do
    it "requires authentication" do
      get "/quests"
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns quests with state" do
      sign_in
      get "/quests"
      expect(response).to have_http_status(:ok)

      json = JSON.parse(response.body)
      expect(json).to be_an(Array)
      expect(json.first["title"]).to eq("付箋を3枚作る")
      expect(json.first["state"]).to eq("not_started")
    end

    # このAPIだけがクエストの個人データを返す経路であり、WebSocket通知は空の合図しか運ばない。
    # キー集合を固定しておくことで、将来ここへ個人情報フィールドが黙って追加されるのを検知する。
    it "returns exactly the expected snapshot keys and nothing more" do
      sign_in
      get "/quests"

      json = JSON.parse(response.body)
      expect(json.first.keys).to match_array(
        %w[id title conditionEvent conditionCount progress state
           achievedAt completedAt rewardGrantedAt skippedAt]
      )
    end
  end

  describe "POST /quests/:id/skip" do
    it "skips the quest and updates state" do
      sign_in
      post "/quests/#{CGI.escape('付箋を3枚作る')}/skip", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:ok)

      json = JSON.parse(response.body)
      expect(json["success"]).to be(true)
      expect(json.dig("snapshot", "state")).to eq("skipped")

      get "/quests"
      json = JSON.parse(response.body)
      expect(json.first["state"]).to eq("skipped")
    end
  end

  describe "POST /quests/:id/reopen" do
    it "reopens a skipped quest" do
      sign_in
      # スキップ
      post "/quests/#{CGI.escape('付箋を3枚作る')}/skip", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:ok)

      # リオープン
      post "/quests/#{CGI.escape('付箋を3枚作る')}/reopen", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:ok)

      json = JSON.parse(response.body)
      expect(json["success"]).to be(true)
      expect(json.dig("snapshot", "state")).to eq("in_progress")

      get "/quests"
      json = JSON.parse(response.body)
      expect(json.first["state"]).to eq("in_progress")
    end
  end

  describe "POST /quests/:id/skip" do
    it "returns unprocessable_content if the quest cannot be skipped (e.g. already skipped)" do
      sign_in
      post "/quests/#{CGI.escape('付箋を3枚作る')}/skip", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:ok)

      post "/quests/#{CGI.escape('付箋を3枚作る')}/skip", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("error" => "クエストをスキップできません")
    end
  end

  describe "POST /quests/:id/reopen" do
    it "returns unprocessable_content if the quest cannot be reopened (e.g. not skipped)" do
      sign_in
      post "/quests/#{CGI.escape('付箋を3枚作る')}/reopen", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("error" => "クエストを再開できません")
    end
  end

  describe "POST /quests/:id/claim" do
    it "returns unprocessable_content if the reward cannot be claimed (e.g. not achieved)" do
      sign_in
      post "/quests/#{CGI.escape('付箋を3枚作る')}/claim", params: { share_token: board.share_token }, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).to eq("error" => "報酬を受け取れません")
    end
  end
end
