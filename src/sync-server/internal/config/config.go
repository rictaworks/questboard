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
	Env                string
	BackendURL         string
}

// validEnvironments enumerates the only values SYNC_SERVER_ENV may take. Unknown values
// must fail startup rather than silently falling back to the permissive development
// authenticator/authorizer/store (see cmd/sync-server/main.go), which would let
// unauthenticated clients broadcast arbitrary operations in a misconfigured deployment.
var validEnvironments = map[string]struct{}{
	"development": {},
	"production":  {},
}

func FromEnv() (Config, error) {
	shardCount, err := parseShardCount(os.Getenv("SYNC_SERVER_SHARD_COUNT"))
	if err != nil {
		return Config{}, err
	}

	env, err := parseEnv(strings.TrimSpace(os.Getenv("SYNC_SERVER_ENV")))
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
		Env:                env,
		BackendURL:         envOrDefault("SYNC_SERVER_BACKEND_URL", "http://localhost:3000"),
	}, nil
}

func parseEnv(env string) (string, error) {
	if env == "" {
		return "", fmt.Errorf("SYNC_SERVER_ENV is required and must be %q or %q", "development", "production")
	}
	if _, ok := validEnvironments[env]; !ok {
		return "", fmt.Errorf("SYNC_SERVER_ENV must be %q or %q, got %q", "development", "production", env)
	}

	return env, nil
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
