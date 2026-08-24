require "rails_helper"

RSpec.describe Auth::XSessionCreator do
  subject(:session_creator) do
    described_class.new(
      recaptcha_verifier: recaptcha_verifier,
      x_oauth_client: x_oauth_client,
      follower_gate: follower_gate
    )
  end

  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let!(:none_plan) { Plan.find_or_create_by!(code: "none") }
  let(:recaptcha_verifier) { instance_double(Auth::RecaptchaVerifier) }
  let(:x_oauth_client) { instance_double(Auth::XOauthClient) }
  let(:follower_gate) { instance_double(Auth::FollowerGate) }

  def resolution(plan:, confirmed: true)
    Auth::FollowerGate::Resolution.new(
      plan: plan, inquiry_id: "x-1", recheck_available: false, confirmed: confirmed
    )
  end

  def create_session
    session_creator.call(code: "code", code_verifier: "verifier", recaptcha_token: "token")
  end

  before do
    allow(recaptcha_verifier).to receive(:verify!).and_return(true)
    allow(x_oauth_client).to receive(:exchange_code!).and_return(
      Auth::XOauthClient::Identity.new(id: "x-1", display_name: "Ada Lovelace")
    )
  end

  it "assigns the plan the gate resolved" do
    allow(follower_gate).to receive(:resolve).with("x-1").and_return(resolution(plan: member_plan))

    expect(create_session.plan).to eq(member_plan)
  end

  # 委譲後は questboard 側にフル同期が無く、ここが唯一の降格経路になる。
  it "demotes an existing member when the gate confirms a restricted plan" do
    User.create!(x_user_id: "x-1", display_name: "Before", plan: member_plan)
    allow(follower_gate).to receive(:resolve).and_return(resolution(plan: none_plan))

    expect(create_session.plan).to eq(none_plan)
  end

  # 判定サービスが X API の障害でプラン値を確定できていない場合（confirmed: false）。
  it "keeps an existing member plan when the gate has not confirmed the decision" do
    existing_user = User.create!(x_user_id: "x-1", display_name: "Before", plan: member_plan)
    allow(follower_gate).to receive(:resolve).and_return(resolution(plan: none_plan, confirmed: false))

    user = create_session

    expect(user.id).to eq(existing_user.id)
    expect(user.plan).to eq(member_plan)
  end

  it "keeps an existing member plan when the gate cannot be reached" do
    User.create!(x_user_id: "x-1", display_name: "Before", plan: member_plan)
    allow(follower_gate).to receive(:resolve).and_raise(Auth::FollowerGateClient::RequestError, "unavailable")

    expect(create_session.plan).to eq(member_plan)
  end

  # 判定できないことを理由にログインを失敗させない（設計書 4.3）。
  it "still creates the session for a new user when the gate cannot be reached" do
    allow(follower_gate).to receive(:resolve).and_raise(Auth::FollowerGateClient::RequestError, "unavailable")

    user = create_session

    expect(user).to be_persisted
    expect(user.plan).to eq(none_plan)
  end
end
