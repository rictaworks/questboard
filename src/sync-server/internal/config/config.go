package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Address        string
	ShardCount     int
	AllowedOrigins []string
}

func FromEnv() (Config, error) {
	shardCount, err := parseShardCount(os.Getenv("SYNC_SERVER_SHARD_COUNT"))
	if err != nil {
		return Config{}, err
	}

	return Config{
		Address:        listenAddress(),
		ShardCount:     shardCount,
		AllowedOrigins: splitList(os.Getenv("SYNC_SERVER_ALLOWED_ORIGINS")),
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
