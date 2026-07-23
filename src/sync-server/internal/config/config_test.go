package config_test

import (
	"testing"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
)

func TestFromEnvShardCount(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantCount int
		wantErr   bool
	}{
		{name: "empty defaults to 1", raw: "", wantCount: 1},
		{name: "valid value is used", raw: "4", wantCount: 4},
		{name: "non-integer is rejected", raw: "abc", wantErr: true},
		{name: "zero is rejected", raw: "0", wantErr: true},
		{name: "negative is rejected", raw: "-1", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// SYNC_SERVER_SHARD_COUNT="" is indistinguishable from unset as far
			// as FromEnv is concerned (both hit os.Getenv's zero value), so
			// this also covers the unset case without depending on whatever
			// the ambient environment happens to have set.
			t.Setenv("SYNC_SERVER_SHARD_COUNT", tt.raw)
			t.Setenv("SYNC_SERVER_ENV", "development")

			cfg, err := config.FromEnv()

			if tt.wantErr {
				if err == nil {
					t.Fatalf("FromEnv() error = nil, want error for SYNC_SERVER_SHARD_COUNT=%q", tt.raw)
				}
				return
			}

			if err != nil {
				t.Fatalf("FromEnv() error = %v, want nil", err)
			}

			if cfg.ShardCount != tt.wantCount {
				t.Fatalf("FromEnv() ShardCount = %d, want %d", cfg.ShardCount, tt.wantCount)
			}
		})
	}
}

func TestFromEnvValidatesEnv(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantEnv string
		wantErr bool
	}{
		// SYNC_SERVER_ENV must never silently fall back to "development": a deployment
		// that forgets to set it would otherwise boot with the permissive dev
		// authenticator/authorizer/store (see cmd/sync-server/main.go) wide open on the
		// public internet. Failing startup is the safe behavior.
		{name: "unset is rejected", raw: "", wantErr: true},
		{name: "development is accepted", raw: "development", wantEnv: "development"},
		{name: "production is accepted", raw: "production", wantEnv: "production"},
		{name: "unknown value is rejected", raw: "prod", wantErr: true},
		{name: "typo is rejected", raw: "Production", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("SYNC_SERVER_ENV", tt.raw)

			cfg, err := config.FromEnv()

			if tt.wantErr {
				if err == nil {
					t.Fatalf("FromEnv() error = nil, want error for SYNC_SERVER_ENV=%q", tt.raw)
				}
				return
			}

			if err != nil {
				t.Fatalf("FromEnv() error = %v, want nil", err)
			}

			if cfg.Env != tt.wantEnv {
				t.Fatalf("FromEnv() Env = %q, want %q", cfg.Env, tt.wantEnv)
			}
		})
	}
}

func TestFromEnvRelaySettings(t *testing.T) {
	t.Setenv("SYNC_SERVER_ENV", "development")
	t.Setenv("SYNC_SERVER_NODE_ID", "node-1")
	t.Setenv("SYNC_SERVER_REDIS_URL", "redis://localhost:6379")
	t.Setenv("SYNC_SERVER_REDIS_CHANNEL_PREFIX", "  custom:sync  ")

	cfg, err := config.FromEnv()
	if err != nil {
		t.Fatalf("FromEnv() error = %v, want nil", err)
	}

	if cfg.NodeID != "node-1" {
		t.Fatalf("FromEnv() NodeID = %q, want node-1", cfg.NodeID)
	}

	if cfg.RedisURL != "redis://localhost:6379" {
		t.Fatalf("FromEnv() RedisURL = %q, want redis://localhost:6379", cfg.RedisURL)
	}

	if cfg.RedisChannelPrefix != "custom:sync" {
		t.Fatalf("FromEnv() RedisChannelPrefix = %q, want custom:sync", cfg.RedisChannelPrefix)
	}
}
