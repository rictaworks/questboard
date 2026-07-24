package ws

import (
	"context"
	"testing"
	"time"
)

// trySend is the delivery primitive RedisRelay.Subscribe's dispatch goroutine uses to hand
// a relayed Op to its reader. These tests exercise it directly (no real Redis needed) since
// reproducing the leak through a live Subscribe/pubSub.Close race would be flaky.

func TestTrySendDeliversWhenReaderIsListening(t *testing.T) {
	ctx := context.Background()
	out := make(chan Op, 1)
	op := Op{BoardID: "board-1"}

	if !trySend(ctx, out, op) {
		t.Fatal("trySend() = false, want true when out has capacity")
	}

	select {
	case got := <-out:
		if got.BoardID != "board-1" {
			t.Fatalf("out received %#v, want BoardID=board-1", got)
		}
	default:
		t.Fatal("trySend() reported success but nothing was sent on out")
	}
}

// TestTrySendReturnsInsteadOfBlockingForeverAfterContextCancellation reproduces the
// PR #53 review finding: with a full, undrained out channel, a plain "out <- op" would
// block forever once the reader has already stopped listening. trySend must instead give
// up as soon as ctx is done, matching what happens in production when
// ensureRelaySubscription's goroutine returns via subCtx.Done() and stops draining out.
func TestTrySendReturnsInsteadOfBlockingForeverAfterContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan Op) // unbuffered and never drained, so a blocking send would hang forever
	op := Op{BoardID: "board-1"}

	cancel()

	done := make(chan bool, 1)
	go func() {
		done <- trySend(ctx, out, op)
	}()

	select {
	case sent := <-done:
		if sent {
			t.Fatal("trySend() = true, want false: it should have observed ctx.Done() instead of delivering")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("trySend() blocked instead of returning once ctx was cancelled — this is the goroutine leak from the PR #53 review")
	}
}
