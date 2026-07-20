package sharding_test

import (
	"testing"

	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
)

func TestRouterResolvesBoardIDDeterministically(t *testing.T) {
	router, err := sharding.NewRouter(4)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	first, err := router.Resolve("board-123")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}

	second, err := router.Resolve("board-123")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}

	if first != second {
		t.Fatalf("Resolve() = %#v, %#v; want deterministic shard selection", first, second)
	}
}

func TestRouterRejectsEmptyBoardID(t *testing.T) {
	router, err := sharding.NewRouter(1)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	if _, err := router.Resolve(""); err == nil {
		t.Fatal("Resolve() error = nil, want boardId validation failure")
	}
}
