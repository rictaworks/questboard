require "rails_helper"

RSpec.describe Auth::FollowerGateClient do
  subject(:client) do
    described_class.new(
      base_url: "https://follower-gate.test",
      client_id: "questboard",
      credential: "test-credential"
    )
  end

  # 応答を差し替えるためだけの器。実際の接続は行わない。
  def stub_response(body, success: true, code: "200")
    http_double = instance_double(Net::HTTP)
    allow(Net::HTTP).to receive(:start).and_yield(http_double)
    allow(http_double).to receive(:request) do |request|
      @captured_request = request

      response = instance_double(Net::HTTPResponse, code: code, body: body)
      allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(success)
      response
    end
  end

  attr_reader :captured_request

  describe "#fetch_decision" do
    it "returns the plan and the inquiry id" do
      stub_response({ plan: "full", decided_at: "2026-08-25T04:00:00.000+09:00", recheck_available: false,
                      inquiry_id: "123456789", confirmed: true }.to_json)

      decision = client.fetch_decision("123456789")

      expect(decision.plan).to eq(described_class::PLAN_FULL)
      expect(decision.inquiry_id).to eq("123456789")
      expect(decision.confirmed).to be(true)
      expect(decision.recheck_available).to be(false)
    end

    it "sends the app credential as a bearer token" do
      stub_response({ plan: "restricted", inquiry_id: "123456789", confirmed: true }.to_json)

      client.fetch_decision("123456789")

      expect(captured_request["Authorization"]).to eq("Bearer questboard:test-credential")
    end

    # 想定外の応答を既定値へ倒さない。倒すと「判定できていない」が「拒否された」として
    # 利用者に見え、既存の member を巻き込む。
    it "raises instead of defaulting when the plan is not one it knows" do
      stub_response({ plan: "unknown", inquiry_id: "123456789", confirmed: true }.to_json)

      expect { client.fetch_decision("123456789") }.to raise_error(described_class::RequestError)
    end

    it "raises when the inquiry id is missing" do
      stub_response({ plan: "full", confirmed: true }.to_json)

      expect { client.fetch_decision("123456789") }.to raise_error(described_class::RequestError)
    end

    it "raises when the response is not JSON" do
      stub_response("<html>maintenance</html>")

      expect { client.fetch_decision("123456789") }.to raise_error(described_class::RequestError)
    end

    # 応答本文をメッセージへ含めない。資格情報の誤りを示す本文がログへ流れる。
    it "does not put the response body into the error message" do
      stub_response({ error: "invalid credential for questboard" }.to_json, success: false, code: "401")

      expect { client.fetch_decision("123456789") }
        .to raise_error(described_class::RequestError) { |error|
          expect(error.message).not_to include("invalid credential")
          expect(error.message).to include("401")
        }
    end

    it "converts a timeout into a request error so it becomes a 502 rather than a 500" do
      allow(Net::HTTP).to receive(:start).and_raise(Net::OpenTimeout)

      expect { client.fetch_decision("123456789") }.to raise_error(described_class::RequestError)
    end

    it "converts a refused connection into a request error" do
      allow(Net::HTTP).to receive(:start).and_raise(Errno::ECONNREFUSED)

      expect { client.fetch_decision("123456789") }.to raise_error(described_class::RequestError)
    end
  end

  describe "#request_recheck" do
    it "returns the accepted result with the resulting plan" do
      stub_response({ result: "accepted", retry_after: nil, plan: "full", inquiry_id: "123456789" }.to_json)

      result = client.request_recheck("123456789")

      expect(result.result).to eq(described_class::RESULT_ACCEPTED)
      expect(result.plan).to eq(described_class::PLAN_FULL)
      expect(result.retry_after).to be_nil
    end

    # 待機のときプラン値は返らない（x-follower-gate SPEC/api/recheck.md）。
    # プラン値を要求すると、正常な待機の応答を異常として扱ってしまう。
    it "accepts a throttled result that carries no plan" do
      stub_response({ result: "throttled", retry_after: "2026-08-25T12:15:00.000+09:00",
                      plan: nil, inquiry_id: "123456789" }.to_json)

      result = client.request_recheck("123456789")

      expect(result.result).to eq(described_class::RESULT_THROTTLED)
      expect(result.plan).to be_nil
      expect(result.retry_after).to eq("2026-08-25T12:15:00.000+09:00")
    end

    # 判定サービスは待機を 429 で返す。2xx 以外を一律で障害として扱うと、正常な待機が
    # 「判定サービスの障害」に化け、利用者へ再要求可能時刻を示せなくなる（本番で踏んだ）。
    it "reads the body of a throttled response instead of treating 429 as an outage" do
      stub_response({ result: "throttled", retry_after: "2026-08-25T12:15:00.000+09:00",
                      plan: nil, inquiry_id: "123456789" }.to_json, success: false, code: "429")

      result = client.request_recheck("123456789")

      expect(result.result).to eq(described_class::RESULT_THROTTLED)
      expect(result.retry_after).to eq("2026-08-25T12:15:00.000+09:00")
    end

    # 資格情報の照合失敗も 429 で返るが、本文は待機の形をしていない。
    # これを待機として通すと、締め出されていることに気づけなくなる。
    it "still treats a 429 that is not a throttled result as an outage" do
      stub_response({ error: "credential_throttled" }.to_json, success: false, code: "429")

      expect { client.request_recheck("123456789") }.to raise_error(described_class::RequestError)
    end

    # 判定の取得には待機の応答が無い。こちらは 429 を障害のまま扱う。
    it "keeps treating a non-success decision response as an outage" do
      stub_response({ result: "throttled" }.to_json, success: false, code: "429")

      expect { client.fetch_decision("123456789") }.to raise_error(described_class::RequestError)
    end

    it "raises when the result is not one it knows" do
      stub_response({ result: "queued", inquiry_id: "123456789" }.to_json)

      expect { client.request_recheck("123456789") }.to raise_error(described_class::RequestError)
    end
  end

  describe "configuration" do
    it "refuses to build without a base url" do
      expect { described_class.new(base_url: "", client_id: "a", credential: "b") }
        .to raise_error(described_class::ConfigurationError)
    end

    it "refuses to build without a credential" do
      expect { described_class.new(base_url: "https://follower-gate.test", client_id: "a", credential: "") }
        .to raise_error(described_class::ConfigurationError)
    end
  end
end
