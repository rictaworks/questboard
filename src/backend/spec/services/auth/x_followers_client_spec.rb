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

    context "when HTTP 429 Too Many Requests is returned" do
      let(:http_double) { instance_double(Net::HTTP) }
      let(:client) { described_class.new(bearer_token: "test-bearer-token", max_retries: 2) }

      before do
        allow(Net::HTTP).to receive(:start).and_yield(http_double)
        allow(client).to receive(:sleep)
      end

      it "retries up to max_retries and parses x-rate-limit-reset" do
        now = Time.now.to_i
        reset_time = now + 10

        response_429 = instance_double(Net::HTTPTooManyRequests, code: "429")
        allow(response_429).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
        allow(response_429).to receive(:[]).with("x-rate-limit-reset").and_return(reset_time.to_s)
        allow(response_429).to receive(:[]).with("Retry-After").and_return(nil)

        success_response = instance_double(Net::HTTPSuccess, code: "200", body: response_body.to_json)
        allow(success_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

        expect(http_double).to receive(:request).twice.and_return(response_429, success_response)
        expect(client).to receive(:sleep).with(be_within(2).of(10))

        page = client.fetch_followers_page(user_id: "123456789", max_results: 100)
        expect(page.ids).to eq(%w[x-1 x-2])
      end

      it "retries and parses Retry-After" do
        response_429 = instance_double(Net::HTTPTooManyRequests, code: "429")
        allow(response_429).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
        allow(response_429).to receive(:[]).with("x-rate-limit-reset").and_return(nil)
        allow(response_429).to receive(:[]).with("Retry-After").and_return("5")

        success_response = instance_double(Net::HTTPSuccess, code: "200", body: response_body.to_json)
        allow(success_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

        expect(http_double).to receive(:request).twice.and_return(response_429, success_response)
        expect(client).to receive(:sleep).with(5)

        page = client.fetch_followers_page(user_id: "123456789", max_results: 100)
        expect(page.ids).to eq(%w[x-1 x-2])
      end

      it "retries and parses Retry-After in HTTP-date format" do
        response_429 = instance_double(Net::HTTPTooManyRequests, code: "429")
        allow(response_429).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
        allow(response_429).to receive(:[]).with("x-rate-limit-reset").and_return(nil)

        future_time = Time.now.utc + 10
        http_date_str = future_time.httpdate
        allow(response_429).to receive(:[]).with("Retry-After").and_return(http_date_str)

        success_response = instance_double(Net::HTTPSuccess, code: "200", body: response_body.to_json)
        allow(success_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

        expect(http_double).to receive(:request).twice.and_return(response_429, success_response)
        expect(client).to receive(:sleep).with(be_within(2).of(10))

        page = client.fetch_followers_page(user_id: "123456789", max_results: 100)
        expect(page.ids).to eq(%w[x-1 x-2])
      end

      it "falls back to default 60 seconds when Retry-After format is invalid" do
        response_429 = instance_double(Net::HTTPTooManyRequests, code: "429")
        allow(response_429).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
        allow(response_429).to receive(:[]).with("x-rate-limit-reset").and_return(nil)
        allow(response_429).to receive(:[]).with("Retry-After").and_return("invalid-format-string")

        success_response = instance_double(Net::HTTPSuccess, code: "200", body: response_body.to_json)
        allow(success_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

        expect(http_double).to receive(:request).twice.and_return(response_429, success_response)
        expect(client).to receive(:sleep).with(60)
        expect(Rails.logger).to receive(:warn).with(/HTTP 429 Too Many Requests/)
        expect(Rails.logger).to receive(:warn).with(/Failed to parse Retry-After header/)

        page = client.fetch_followers_page(user_id: "123456789", max_results: 100)
        expect(page.ids).to eq(%w[x-1 x-2])
      end

      it "raises RequestError when retries exceed max_retries" do
        response_429 = instance_double(Net::HTTPTooManyRequests, code: "429")
        allow(response_429).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
        allow(response_429).to receive(:[]).with("x-rate-limit-reset").and_return(nil)
        allow(response_429).to receive(:[]).with("Retry-After").and_return(nil)

        expect(http_double).to receive(:request).exactly(3).times.and_return(response_429)
        expect(client).to receive(:sleep).twice.with(60)

        expect {
          client.fetch_followers_page(user_id: "123456789", max_results: 100)
        }.to raise_error(Auth::XFollowersClient::RequestError, /failed with 429/)
      end

      # 利用者のリクエストを処理するスレッド上で呼ぶ経路（Auth::ManualFollowerRecheck）は
      # max_retries: 0 を渡す。x-rate-limit-reset は X のレート制限窓の終端（最大15分先）を
      # 指すため、待ってから再試行するとその間 Puma のワーカースレッドが塞がる。
      context "when max_retries is 0" do
        let(:client) { described_class.new(bearer_token: "test-bearer-token", max_retries: 0) }

        it "raises RequestError immediately without sleeping" do
          response_429 = instance_double(Net::HTTPTooManyRequests, code: "429")
          allow(response_429).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)

          expect(http_double).to receive(:request).once.and_return(response_429)
          expect(client).not_to receive(:sleep)

          expect {
            client.fetch_followers_page(user_id: "123456789", max_results: 100)
          }.to raise_error(Auth::XFollowersClient::RequestError, /failed with 429/)
        end
      end
    end

    # タイムアウトは X API 側の一時的な障害であり、ApplicationController が
    # Auth::XFollowersClient::Error を 502（api.errors.x_followers_unavailable）へ
    # 変換する経路に載せる必要がある。素の Net::ReadTimeout のままだと 500 になり、
    # 「一時的な失敗なので時間をおいて再試行してほしい」と伝えられない。
    it "reports a read timeout as a request error" do
      allow(Net::HTTP).to receive(:start).and_raise(Net::ReadTimeout)

      expect {
        client.fetch_followers_page(user_id: "123456789", max_results: 100)
      }.to raise_error(Auth::XFollowersClient::RequestError, /timed out/)
    end

    it "reports a connection timeout as a request error" do
      allow(Net::HTTP).to receive(:start).and_raise(Net::OpenTimeout)

      expect {
        client.fetch_followers_page(user_id: "123456789", max_results: 100)
      }.to raise_error(Auth::XFollowersClient::RequestError, /timed out/)
    end

    # 再試行を止めても、応答を返さない相手に対しては Net::HTTP の既定（無制限）のままだと
    # スレッドが張り付いたままになる。接続・読み取りの両方に上限を置く。
    it "bounds how long a single request can occupy the calling thread" do
      client.fetch_followers_page(user_id: "123456789", max_results: 100)

      expect(Net::HTTP).to have_received(:start).with(
        "api.x.com",
        443,
        hash_including(
          open_timeout: Auth::XFollowersClient::OPEN_TIMEOUT_SECONDS,
          read_timeout: Auth::XFollowersClient::READ_TIMEOUT_SECONDS
        )
      )
    end
  end
end
