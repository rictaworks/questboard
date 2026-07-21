require "rails_helper"

RSpec.describe "Boards", type: :request do
  let(:session_creator) { instance_double(Auth::GoogleSessionCreator) }
  let(:owner) { User.create!(google_sub: "google-sub-owner", display_name: "Owner User") }
  let(:member) { User.create!(google_sub: "google-sub-member", display_name: "Member User") }

  before do
    allow(Auth::GoogleSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
  end

  def seed_roles
    Role.upsert_all(
      [
        { code: "owner" },
        { code: "editor" },
        { code: "commenter" },
        { code: "viewer" }
      ],
      unique_by: :index_roles_on_code
    )
  end

  def sign_in(user)
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/google_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }

    expect(response).to have_http_status(:created)
  end

  def create_board(title: "Strategy Board")
    sign_in(owner)
    post "/boards", params: { title: }

    expect(response).to have_http_status(:created)
    JSON.parse(response.body)
  end

  it "creates a board and assigns the creator as owner" do
    sign_in(owner)

    post "/boards", params: { title: "Launch Plan" }

    expect(response).to have_http_status(:created)
    payload = JSON.parse(response.body)
    board = Board.find_by!(share_token: payload.fetch("board").fetch("shareToken"))
    membership = BoardMember.find_by!(board:, user: owner)

    expect(payload.dig("membership", "role", "code")).to eq("owner")
    expect(board.title).to eq("Launch Plan")
    expect(board.share_token).to match(/\A[1-9A-HJ-NP-Za-km-z]{24}\z/)
    expect(membership.role.code).to eq("owner")
  end

  it "joins a board through the share token with the selected invite role" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)

    post "/boards/#{share_token}/join", params: { role_code: "editor" }

    expect(response).to have_http_status(:created)
    membership = BoardMember.find_by!(board: Board.find_by!(share_token:), user: member)

    expect(JSON.parse(response.body).dig("membership", "role", "code")).to eq("editor")
    expect(membership.role.code).to eq("editor")
  end

  it "lets the owner change another member role and blocks non-owners" do
    board_payload = create_board
    share_token = board_payload.fetch("board").fetch("shareToken")

    sign_in(member)
    post "/boards/#{share_token}/join", params: { role_code: "viewer" }
    expect(response).to have_http_status(:created)

    sign_in(owner)
    patch "/boards/#{share_token}/members/#{member.id}", params: { role_code: "commenter" }

    expect(response).to have_http_status(:ok)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("commenter")

    sign_in(member)
    patch "/boards/#{share_token}/members/#{owner.id}", params: { role_code: "editor" }

    expect(response).to have_http_status(:forbidden)
    expect(BoardMember.find_by!(board: Board.find_by!(share_token:), user: member).role.code).to eq("commenter")
  end
end
