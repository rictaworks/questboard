package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Address        string
	ShardCount     int
	AllowedOrigins []string
}

func FromEnv() Config {
	return Config{
		Address:        listenAddress(),
		ShardCount:     parseShardCount(os.Getenv("SYNC_SERVER_SHARD_COUNT")),
		AllowedOrigins: splitList(os.Getenv("SYNC_SERVER_ALLOWED_ORIGINS")),
	}
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

func parseShardCount(raw string) int {
	if raw == "" {
		return 1
	}

	count, err := strconv.Atoi(raw)
	if err != nil || count < 1 {
		return 1
	}

	return count
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
