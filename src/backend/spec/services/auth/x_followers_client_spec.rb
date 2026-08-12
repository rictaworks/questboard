require "rails_helper"

RSpec.describe Auth::XFollowersClient do
  subject(:client) { described_class.new(bearer_token: "test-bearer-token") }

  describe "#fetch_followers_page" do
    let(:response_body) do
      {
        data: [
          { id: "x-1" },
          { id: "x-2" }
        ],
        meta: {
          next_token: "next-page"
        }
      }
    end

    before do
      http_double = instance_double(Net::HTTP)
      allow(Net::HTTP).to receive(:start).and_yield(http_double)
      allow(http_double).to receive(:request) do |request|
        expect(request["Authorization"]).to start_with("Bearer ")

        response = instance_double(Net::HTTPSuccess, code: "200", body: response_body.to_json)
        allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)
        response
      end
    end

    it "returns follower ids and the next page token" do
      page = client.fetch_followers_page(user_id: "123456789", max_results: 100)

      expect(page.ids).to eq(%w[x-1 x-2])
      expect(page.next_token).to eq("next-page")
    end
  end
end
