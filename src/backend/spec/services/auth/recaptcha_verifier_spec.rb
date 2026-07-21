require "rails_helper"

RSpec.describe Auth::RecaptchaVerifier do
  subject(:verifier) { described_class.new(secret_key: "test-secret-key") }

  describe "#verify!" do
    let(:http_response) { instance_double(Net::HTTPSuccess, code: "200") }

    before do
      allow(http_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)
      allow(Net::HTTP).to receive(:start).and_yield(instance_double(Net::HTTP, request: http_response))
    end

    context "when response is successful with valid score and action" do
      before do
        allow(http_response).to receive(:body).and_return({ success: true, score: 0.9, action: "login" }.to_json)
      end

      it "returns true" do
        expect(verifier.verify!(token: "valid-token")).to be true
      end
    end

    context "when success is false" do
      before do
        allow(http_response).to receive(:body).and_return({ success: false }.to_json)
      end

      it "raises Error" do
        expect { verifier.verify!(token: "bad-token") }
          .to raise_error(Auth::RecaptchaVerifier::Error, "reCAPTCHA verification failed")
      end
    end

    context "when action mismatches" do
      before do
        allow(http_response).to receive(:body).and_return({ success: true, score: 0.9, action: "unrelated" }.to_json)
      end

      it "raises action mismatch Error" do
        expect { verifier.verify!(token: "valid-token") }
          .to raise_error(Auth::RecaptchaVerifier::Error, "reCAPTCHA action mismatch")
      end
    end

    context "when score is lower than min_score" do
      before do
        allow(http_response).to receive(:body).and_return({ success: true, score: 0.3, action: "login" }.to_json)
      end

      it "raises score too low Error" do
        expect { verifier.verify!(token: "valid-token") }
          .to raise_error(Auth::RecaptchaVerifier::Error, "reCAPTCHA score too low")
      end
    end
  end
end
