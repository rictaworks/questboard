package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Address            string
	ShardCount         int
	AllowedOrigins     []string
	NodeID             string
	RedisURL           string
	RedisChannelPrefix string
}

func FromEnv() (Config, error) {
	shardCount, err := parseShardCount(os.Getenv("SYNC_SERVER_SHARD_COUNT"))
	if err != nil {
		return Config{}, err
	}

	return Config{
		Address:            listenAddress(),
		ShardCount:         shardCount,
		AllowedOrigins:     splitList(os.Getenv("SYNC_SERVER_ALLOWED_ORIGINS")),
		NodeID:             envOrDefault("SYNC_SERVER_NODE_ID", defaultNodeID()),
		RedisURL:           strings.TrimSpace(os.Getenv("SYNC_SERVER_REDIS_URL")),
		RedisChannelPrefix: envOrDefault("SYNC_SERVER_REDIS_CHANNEL_PREFIX", "questboard:sync"),
	}, nil
}

func listenAddress() string {
	if address := strings.TrimSpace(os.Getenv("SYNC_SERVER_ADDR")); address != "" {
		return address
	}

	if port := strings.TrimSpace(os.Getenv("PORT")); port != "" {
		return ":" + port
	}

	return ":8080"
}

func parseShardCount(raw string) (int, error) {
	if raw == "" {
		return 1, nil
	}

	count, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("SYNC_SERVER_SHARD_COUNT must be an integer: %q", raw)
	}

	if count < 1 {
		return 0, fmt.Errorf("SYNC_SERVER_SHARD_COUNT must be at least 1: %q", raw)
	}

	return count, nil
}

func splitList(raw string) []string {
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	allowed := make([]string, 0, len(parts))

	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value != "" {
			allowed = append(allowed, value)
		}
	}

	return allowed
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}

	return fallback
}

func defaultNodeID() string {
	if hostname, err := os.Hostname(); err == nil && strings.TrimSpace(hostname) != "" {
		return strings.TrimSpace(hostname)
	}

	return "sync-server-local"
}
