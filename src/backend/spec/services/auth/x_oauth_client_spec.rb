require "rails_helper"

RSpec.describe Auth::XOauthClient do
  subject(:client) do
    described_class.new(
      client_id: "test-client-id",
      redirect_uri: "https://app.example.com/auth/x/callback"
    )
  end

  let(:token_payload) { { "access_token" => "access-token" } }
  let(:user_info_payload) { { "data" => { "id" => "x-user-123", "name" => "Ada Lovelace" } } }

  def success_response(body)
    response = instance_double(Net::HTTPSuccess, code: "200", body: body.to_json)
    allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)
    response
  end

  before do
    http_double = instance_double(Net::HTTP)
    allow(Net::HTTP).to receive(:start).and_yield(http_double)
    allow(http_double).to receive(:request) do |request|
      case request.path
      when "/2/oauth2/token"
        success_response(token_payload)
      when "/2/users/me"
        success_response(user_info_payload)
      else
        raise "unexpected request path: #{request.path}"
      end
    end
  end

  describe "#initialize" do
    it "raises ConfigurationError when required settings are missing" do
      expect { described_class.new(client_id: "", redirect_uri: "uri") }
        .to raise_error(Auth::XOauthClient::ConfigurationError)
    end
  end

  describe "#exchange_code!" do
    it "returns the identity from a valid token exchange" do
      identity = client.exchange_code!(code: "auth-code", code_verifier: "verifier")

      expect(identity.id).to eq("x-user-123")
      expect(identity.display_name).to eq("Ada Lovelace")
    end

    it "raises RequestError when the user info response is missing data" do
      user_info_payload.delete("data")

      expect { client.exchange_code!(code: "auth-code", code_verifier: "verifier") }
        .to raise_error(Auth::XOauthClient::RequestError, /missing an expected field/)
    end
  end
end
