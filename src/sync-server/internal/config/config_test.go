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
