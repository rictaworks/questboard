require "rails_helper"

RSpec.describe "Board lists", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:owner) { User.create!(x_user_id: "x-sub-board-owner", display_name: "Owner User", plan: member_plan) }
  let(:other_owner) { User.create!(x_user_id: "x-sub-board-other-owner", display_name: "Other Owner", plan: member_plan) }
  let(:viewer) { User.create!(x_user_id: "x-sub-board-viewer", display_name: "Viewer User", plan: member_plan) }
  let(:blocked_user) { User.create!(x_user_id: "x-sub-board-blocked", display_name: "Blocked User", plan: none_plan) }

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
  end

  def create_board(title:)
    post "/boards", params: { title: }, as: :json

    expect(response).to have_http_status(:created)
    JSON.parse(response.body)
  end

  def join_board(share_token, role_code:)
    post "/boards/#{share_token}/join", params: { role_code: }, as: :json
    expect(response).to have_http_status(:created)
  end

  def fetch_board_list(page:, per_page:)
    get "/boards", params: { page:, per_page: }, as: :json

    expect(response).to have_http_status(:ok)
    JSON.parse(response.body)
  end

  def create_board_object(board:, at:)
    travel_to(at) do
      object_type = ObjectType.find_or_create_by!(code: "sticky")
      color = ColorPalette.find_or_create_by!(hex: "#FDE68A")

      BoardObject.create!(
        board:,
        object_type:,
        color_palette: color,
        geometry: { "x" => 1, "y" => 2, "w" => 3, "h" => 4, "rotation" => 0 },
        text_crdt: {},
        deleted_at: nil
      )
    end
  end

  it "paginates current-user boards by updated_at and keeps role labels aligned with membership" do
    sign_in(owner)
    first_board = travel_to(Time.zone.parse("2026-08-01 10:00:00")) { create_board(title: "Owned Board") }
    first_share_token = first_board.fetch("board").fetch("shareToken")

    sign_in(other_owner)
    second_board = travel_to(Time.zone.parse("2026-08-01 10:10:00")) { create_board(title: "Joined Board") }
    second_share_token = second_board.fetch("board").fetch("shareToken")

    sign_in(owner)
    travel_to(Time.zone.parse("2026-08-01 10:20:00")) do
      join_board(second_share_token, role_code: "editor")
    end

    sign_in(viewer)
    travel_to(Time.zone.parse("2026-08-01 10:30:00")) do
      join_board(first_share_token, role_code: "viewer")
    end

    sign_in(owner)
    first_page = fetch_board_list(page: 1, per_page: 1)
    second_page = fetch_board_list(page: 2, per_page: 1)

    expect(first_page.fetch("boards")).to have_length(1)
    expect(first_page.fetch("boards").first).to include(
      "title" => "Owned Board",
      "roleCode" => "owner",
      "shareToken" => first_share_token
    )
    expect(Time.zone.parse(first_page.fetch("boards").first.fetch("updatedAt"))).to eq(Time.zone.parse("2026-08-01 10:30:00"))
    expect(first_page.fetch("pagination")).to include(
      "page" => 1,
      "perPage" => 1,
      "totalCount" => 2,
      "totalPages" => 2,
      "previousPage" => nil,
      "nextPage" => 2
    )

    expect(second_page.fetch("boards")).to have_length(1)
    expect(second_page.fetch("boards").first).to include(
      "title" => "Joined Board",
      "roleCode" => "editor",
      "shareToken" => second_share_token
    )
    expect(second_page.fetch("pagination")).to include(
      "page" => 2,
      "perPage" => 1,
      "totalCount" => 2,
      "totalPages" => 2,
      "previousPage" => 1,
      "nextPage" => nil
    )
  end

  it "updates board recency when a comment is added to a board object" do
    sign_in(owner)
    first_board = travel_to(Time.zone.parse("2026-08-01 10:00:00")) { create_board(title: "Commented Board") }
    first_share_token = first_board.fetch("board").fetch("shareToken")
    first_board_record = Board.find_by!(share_token: first_share_token)
    board_object = create_board_object(board: first_board_record, at: Time.zone.parse("2026-08-01 10:05:00"))

    sign_in(other_owner)
    second_board = travel_to(Time.zone.parse("2026-08-01 10:10:00")) { create_board(title: "Later Board") }
    second_share_token = second_board.fetch("board").fetch("shareToken")

    sign_in(owner)
    travel_to(Time.zone.parse("2026-08-01 10:20:00")) do
      join_board(second_share_token, role_code: "editor")
    end

    travel_to(Time.zone.parse("2026-08-01 10:30:00")) do
      Comment.create!(board_object:, user: owner, body: "Thanks")
    end

    board_list = fetch_board_list(page: 1, per_page: 2)

    expect(board_list.fetch("boards").map { |entry| entry.fetch("title") }).to eq([ "Commented Board", "Later Board" ])
    expect(board_list.fetch("boards").first.fetch("roleCode")).to eq("owner")
    expect(board_list.fetch("boards").second.fetch("roleCode")).to eq("editor")
    expect(Time.zone.parse(board_list.fetch("boards").first.fetch("updatedAt"))).to eq(Time.zone.parse("2026-08-01 10:30:00"))
  end

  it "returns unauthorized when no session exists" do
    get "/boards", params: { page: 1, per_page: 10 }, as: :json

    expect(response).to have_http_status(:unauthorized)
  end

  it "allows board list access for users on the none plan" do
    sign_in(blocked_user)

    get "/boards", params: { page: 1, per_page: 10 }, as: :json

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).fetch("boards")).to eq([])
  end
end
