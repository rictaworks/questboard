# Publishes a confirmed ObjectOp to the same Redis channel/envelope shape sync-server's
# own RedisRelay subscribes to (see src/sync-server/internal/ws/relay_redis.go), so a
# write made through a legacy (non-WebSocket) endpoint reaches connected clients exactly
# as if it had arrived as a normal op. Without this, a connected client stays unaware that
# the op log's "latest" pointer advanced, and its next legitimate edit is rejected as
# stale with nothing telling it to resync (see PR #53 review).
#
# Publishing is best-effort: callers should not roll back the underlying object mutation
# just because real-time notification failed (the object_ops row remains the source of
# truth regardless), so #publish wraps any failure in PublishError rather than leaving the
# caller to guess what raised.
class SyncOpRelay
  class PublishError < StandardError; end

  # Must stay out of the hostname-shaped pool an operator would plausibly pick for
  # SYNC_SERVER_NODE_ID — RedisRelay drops any envelope whose Origin matches its own nodeID
  # (self-echo suppression), so a collision would silently swallow every legacy-origin op
  # instead of rebroadcasting it (see src/sync-server/internal/config/config.go, which
  # rejects this exact value at startup, and PR #53 review).
  ORIGIN = "questboard-rails-backend"

  @pool_mutex = Mutex.new

  # redis_client is an injection point for tests only: production callers go through the
  # shared pool below so every request reuses live connections instead of dialing Redis
  # anew (Rails builds a fresh controller — and thus a fresh SyncOpRelay — per request; see
  # PR #53 review).
  def initialize(redis_client: nil, channel_prefix: nil)
    @redis_client = redis_client
    # .presence (not ENV.fetch's default) so an explicitly-exported-but-empty
    # SYNC_SERVER_REDIS_CHANNEL_PREFIX="" still falls back — matching sync-server's own
    # envOrDefault, which blank-checks rather than presence-checks (see config.go and PR #53
    # review). A mismatch here means Rails publishes to a different channel than RedisRelay
    # subscribes to, silently dropping every legacy-origin op.
    @channel_prefix = channel_prefix.presence || ENV["SYNC_SERVER_REDIS_CHANNEL_PREFIX"].to_s.strip.presence || "questboard:sync"
  end

  def publish(board_share_token:, object_op:)
    envelope = {
      origin: ORIGIN,
      op: {
        boardId: board_share_token,
        objectId: object_op.object_id.to_s,
        property: object_op.property,
        value: object_op.value,
        lamport_ts: object_op.lamport_ts,
        clientId: object_op.client_id
      }
    }
    channel = "#{@channel_prefix}:#{board_share_token}"
    payload = envelope.to_json

    if @redis_client
      @redis_client.publish(channel, payload)
    else
      pool = self.class.shared_pool
      pool&.with { |client| client.publish(channel, payload) }
    end
  rescue PublishError
    raise
  rescue StandardError => e
    raise PublishError, e.message
  end

  # Building the Redis::Client (which parses SYNC_SERVER_REDIS_URL) is deferred to
  # ConnectionPool#with, i.e. inside #publish's own rescue, so a malformed URL surfaces as
  # a PublishError like any other relay failure instead of raising out of .new and turning
  # a successful mutation into a 500 (see PR #53 review).
  def self.shared_pool
    return @shared_pool if defined?(@shared_pool)

    @pool_mutex.synchronize { @shared_pool ||= build_redis_pool }
  end

  def self.build_redis_pool
    url = ENV["SYNC_SERVER_REDIS_URL"].presence
    return nil unless url

    # .presence (not ENV.fetch's default) so an explicitly-exported-but-empty
    # SYNC_SERVER_REDIS_POOL_SIZE="" still falls back to RAILS_MAX_THREADS instead of
    # Integer("") raising ArgumentError, which #publish's rescue would otherwise swallow as
    # a PublishError on every call — silently breaking the relay while legacy HTTP updates
    # keep returning 200 (see PR #53 review).
    pool_size = Integer(ENV["SYNC_SERVER_REDIS_POOL_SIZE"].presence || ENV["RAILS_MAX_THREADS"].presence || 5)
    ConnectionPool.new(size: pool_size, timeout: 5) { Redis.new(url:) }
  end
end
