require "rails_helper"

RSpec.describe Auth::GoogleOauthClient do
  subject(:client) do
    described_class.new(
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      redirect_uri: "https://app.example.com/auth/google/callback"
    )
  end

  let(:valid_exp) { Time.now.to_i + 3600 }
  let(:token_payload) { { "id_token" => "id-token", "access_token" => "access-token" } }
  let(:token_info_payload) do
    { "sub" => "google-sub-123", "iss" => "https://accounts.google.com", "aud" => "test-client-id", "exp" => valid_exp }
  end
  let(:user_info_payload) { { "name" => "Ada Lovelace", "email" => "ada@example.com" } }

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
      when "/token"
        success_response(token_payload)
      when %r{\A/tokeninfo}
        success_response(token_info_payload)
      when "/v1/userinfo"
        success_response(user_info_payload)
      else
        raise "unexpected request path: #{request.path}"
      end
    end
  end

  describe "#initialize" do
    it "raises ConfigurationError when required settings are missing" do
      expect { described_class.new(client_id: "", client_secret: "secret", redirect_uri: "uri") }
        .to raise_error(Auth::GoogleOauthClient::ConfigurationError)
    end
  end

  describe "#exchange_code!" do
    it "returns the identity from a valid token exchange" do
      identity = client.exchange_code!(code: "auth-code", code_verifier: "verifier")

      expect(identity.sub).to eq("google-sub-123")
      expect(identity.display_name).to eq("Ada Lovelace")
    end

    it "falls back to email when the userinfo response has no name" do
      user_info_payload.delete("name")

      identity = client.exchange_code!(code: "auth-code", code_verifier: "verifier")

      expect(identity.display_name).to eq("ada@example.com")
    end

    it "raises RequestError when the issuer is unexpected" do
      token_info_payload["iss"] = "https://evil.example.com"

      expect { client.exchange_code!(code: "auth-code", code_verifier: "verifier") }
        .to raise_error(Auth::GoogleOauthClient::RequestError, "Google token issuer is invalid")
    end

    it "raises RequestError when the audience does not match the client id" do
      token_info_payload["aud"] = "another-client-id"

      expect { client.exchange_code!(code: "auth-code", code_verifier: "verifier") }
        .to raise_error(Auth::GoogleOauthClient::RequestError, "Google token audience is invalid")
    end

    it "raises RequestError when the token is expired" do
      token_info_payload["exp"] = Time.now.to_i - 60

      expect { client.exchange_code!(code: "auth-code", code_verifier: "verifier") }
        .to raise_error(Auth::GoogleOauthClient::RequestError, "Google token is expired")
    end

    it "raises RequestError when an expected field is missing from Google's response" do
      token_payload.delete("id_token")

      expect { client.exchange_code!(code: "auth-code", code_verifier: "verifier") }
        .to raise_error(Auth::GoogleOauthClient::RequestError, /missing an expected field/)
    end
  end
end
