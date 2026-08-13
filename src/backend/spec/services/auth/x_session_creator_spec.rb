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
  let(:follower_gate) { Auth::FollowerGate.new }

  before do
    allow(recaptcha_verifier).to receive(:verify!).and_return(true)
    allow(x_oauth_client).to receive(:exchange_code!).and_return(
      Auth::XOauthClient::Identity.new(id: "x-1", display_name: "Ada Lovelace")
    )
  end

  it "assigns the member plan when the user is cached as a follower" do
    FollowerCache.create!(x_user_id: "x-1", fetched_at: Time.current)

    user = session_creator.call(code: "code", code_verifier: "verifier", recaptcha_token: "token")

    expect(user.plan).to eq(member_plan)
  end

  it "keeps an existing member plan when the cache misses" do
    existing_user = User.create!(x_user_id: "x-1", display_name: "Before", plan: member_plan)

    user = session_creator.call(code: "code", code_verifier: "verifier", recaptcha_token: "token")

    expect(user.id).to eq(existing_user.id)
    expect(user.plan).to eq(member_plan)
  end
end
