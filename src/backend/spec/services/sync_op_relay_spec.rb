require "rails_helper"

RSpec.describe SyncOpRelay do
  let(:fake_redis) { instance_double(Redis, publish: 1) }
  let(:object_op) do
    ObjectOp.new(
      object_id: 42,
      property: "geometry",
      value: { "x" => 10, "y" => 20 },
      lamport_ts: 7,
      client_id: "legacy"
    )
  end

  describe "#publish" do
    it "publishes to the same channel naming sync-server's RedisRelay subscribes to" do
      relay = described_class.new(redis_client: fake_redis, channel_prefix: "questboard:sync")

      relay.publish(board_share_token: "share-abc", object_op:)

      expect(fake_redis).to have_received(:publish).with("questboard:sync:share-abc", anything)
    end

    it "publishes an envelope matching sync-server's relayEnvelope{origin, op} JSON shape" do
      relay = described_class.new(redis_client: fake_redis, channel_prefix: "questboard:sync")

      relay.publish(board_share_token: "share-abc", object_op:)

      expect(fake_redis).to have_received(:publish) do |_channel, payload|
        decoded = JSON.parse(payload)
        expect(decoded.fetch("origin")).to eq("questboard-rails-backend")
        expect(decoded.fetch("op")).to eq(
          "boardId" => "share-abc",
          "objectId" => "42",
          "property" => "geometry",
          "value" => { "x" => 10, "y" => 20 },
          "lamport_ts" => 7,
          "clientId" => "legacy"
        )
      end
    end

    it "is a no-op when no redis client is configured (e.g. relay disabled in dev)" do
      relay = described_class.new(redis_client: nil, channel_prefix: "questboard:sync")

      expect { relay.publish(board_share_token: "share-abc", object_op:) }.not_to raise_error
    end

    it "wraps a redis failure in SyncOpRelay::PublishError instead of letting it propagate raw" do
      allow(fake_redis).to receive(:publish).and_raise(StandardError, "connection refused")
      relay = described_class.new(redis_client: fake_redis, channel_prefix: "questboard:sync")

      expect { relay.publish(board_share_token: "share-abc", object_op:) }
        .to raise_error(SyncOpRelay::PublishError, /connection refused/)
    end

    it "falls back to the default channel prefix when SYNC_SERVER_REDIS_CHANNEL_PREFIX is exported but blank" do
      original = ENV["SYNC_SERVER_REDIS_CHANNEL_PREFIX"]
      begin
        ENV["SYNC_SERVER_REDIS_CHANNEL_PREFIX"] = ""
        relay = described_class.new(redis_client: fake_redis)

        relay.publish(board_share_token: "share-abc", object_op:)

        expect(fake_redis).to have_received(:publish).with("questboard:sync:share-abc", anything)
      ensure
        ENV["SYNC_SERVER_REDIS_CHANNEL_PREFIX"] = original
      end
    end
  end

  describe "shared pool (no redis_client injected)" do
    around do |example|
      original_url = ENV["SYNC_SERVER_REDIS_URL"]
      described_class.remove_instance_variable(:@shared_pool) if described_class.instance_variable_defined?(:@shared_pool)
      example.run
    ensure
      ENV["SYNC_SERVER_REDIS_URL"] = original_url
      described_class.remove_instance_variable(:@shared_pool) if described_class.instance_variable_defined?(:@shared_pool)
    end

    it "is a no-op and never builds a pool when SYNC_SERVER_REDIS_URL is unset" do
      ENV["SYNC_SERVER_REDIS_URL"] = nil
      relay = described_class.new(channel_prefix: "questboard:sync")

      expect { relay.publish(board_share_token: "share-abc", object_op:) }.not_to raise_error
      expect(described_class.shared_pool).to be_nil
    end

    it "reuses the same pool across instances instead of dialing Redis per request" do
      ENV["SYNC_SERVER_REDIS_URL"] = "redis://localhost:6379"

      described_class.new(channel_prefix: "questboard:sync")
      first_pool = described_class.shared_pool
      described_class.new(channel_prefix: "questboard:sync")
      second_pool = described_class.shared_pool

      expect(first_pool).to be(second_pool)
      expect(first_pool).to be_a(ConnectionPool)
    end

    it "wraps a malformed SYNC_SERVER_REDIS_URL in PublishError instead of raising out of .new" do
      ENV["SYNC_SERVER_REDIS_URL"] = "not a valid redis url"

      relay = nil
      expect { relay = described_class.new(channel_prefix: "questboard:sync") }.not_to raise_error
      expect { relay.publish(board_share_token: "share-abc", object_op:) }
        .to raise_error(SyncOpRelay::PublishError)
    end

    it "falls back to RAILS_MAX_THREADS when SYNC_SERVER_REDIS_POOL_SIZE is exported but blank" do
      ENV["SYNC_SERVER_REDIS_URL"] = "redis://localhost:6379"
      original_pool_size = ENV["SYNC_SERVER_REDIS_POOL_SIZE"]
      original_max_threads = ENV["RAILS_MAX_THREADS"]
      begin
        ENV["SYNC_SERVER_REDIS_POOL_SIZE"] = ""
        ENV["RAILS_MAX_THREADS"] = "9"

        pool = described_class.build_redis_pool

        expect(pool.size).to eq(9)
      ensure
        ENV["SYNC_SERVER_REDIS_POOL_SIZE"] = original_pool_size
        ENV["RAILS_MAX_THREADS"] = original_max_threads
      end
    end

    it "falls back to a default pool size when both SYNC_SERVER_REDIS_POOL_SIZE and RAILS_MAX_THREADS are blank" do
      ENV["SYNC_SERVER_REDIS_URL"] = "redis://localhost:6379"
      original_pool_size = ENV["SYNC_SERVER_REDIS_POOL_SIZE"]
      original_max_threads = ENV["RAILS_MAX_THREADS"]
      begin
        ENV["SYNC_SERVER_REDIS_POOL_SIZE"] = ""
        ENV["RAILS_MAX_THREADS"] = ""

        pool = described_class.build_redis_pool

        expect(pool.size).to eq(5)
      ensure
        ENV["SYNC_SERVER_REDIS_POOL_SIZE"] = original_pool_size
        ENV["RAILS_MAX_THREADS"] = original_max_threads
      end
    end
  end
end
