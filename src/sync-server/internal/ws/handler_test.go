package ws_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

type stubRelay struct {
	mu   sync.Mutex
	subs map[string]chan ws.Op
}

func newStubRelay() *stubRelay {
	return &stubRelay{subs: make(map[string]chan ws.Op)}
}

func (r *stubRelay) Subscribe(_ context.Context, boardID string) (<-chan ws.Op, func(), error) {
	ch := make(chan ws.Op, 1)
	r.mu.Lock()
	r.subs[boardID] = ch
	r.mu.Unlock()
	return ch, func() {}, nil
}

func (r *stubRelay) Publish(context.Context, ws.Op) error { return nil }

func (r *stubRelay) Close() error { return nil }

func (r *stubRelay) Emit(boardID string, op ws.Op) {
	r.mu.Lock()
	ch := r.subs[boardID]
	r.mu.Unlock()
	if ch == nil {
		return
	}
	ch <- op
}

func TestConfirmedOpsBroadcastToSameBoardConnections(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"
	connA := mustDialWebSocket(t, wsURL)
	defer connA.Close()
	connB := mustDialWebSocket(t, wsURL)
	defer connB.Close()

	op := map[string]any{
		"boardId":    "board-123",
		"objectId":   "object-1",
		"property":   "geometry",
		"value":      map[string]any{"x": 20, "y": 40},
		"lamport_ts": 7,
		"clientId":   "client-a",
	}
	mustWriteJSON(t, connA, op)

	gotA := mustReadJSONMessage(t, connA)
	gotB := mustReadJSONMessage(t, connB)

	assertJSONField(t, gotA, "boardId", "board-123")
	assertJSONField(t, gotA, "clientId", "client-a")
	assertJSONField(t, gotB, "objectId", "object-1")
	assertJSONField(t, gotB, "property", "geometry")
}

func TestRedisRelayBroadcastsRemoteOps(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)
	relay := newStubRelay()
	handler.SetRelay(relay)

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-777"
	conn := mustDialWebSocket(t, wsURL)
	defer conn.Close()

	remote := ws.Op{
		BoardID:   "board-777",
		ObjectID:  "object-9",
		Property:  "color",
		Value:     json.RawMessage(`{"hex":"#ff00ff"}`),
		LamportTS: 42,
		ClientID:  "remote-node",
	}

	waitForRelaySubscription(t, relay, "board-777")
	relay.Emit("board-777", remote)

	got := mustReadJSONMessage(t, conn)
	assertJSONField(t, got, "objectId", "object-9")
	assertJSONField(t, got, "clientId", "remote-node")
}

func mustDialWebSocket(t *testing.T, wsURL string) *websocket.Conn {
	t.Helper()

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}

	return conn
}

func mustWriteJSON(t *testing.T, conn *websocket.Conn, payload any) {
	t.Helper()

	if err := conn.WriteJSON(payload); err != nil {
		t.Fatalf("websocket write failed: %v", err)
	}
}

func mustReadJSONMessage(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()

	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}

	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("websocket read failed: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("json unmarshal failed: %v", err)
	}

	return payload
}

func assertJSONField(t *testing.T, payload map[string]any, field, want string) {
	t.Helper()

	got, ok := payload[field].(string)
	if !ok {
		t.Fatalf("payload[%q] = %T, want string", field, payload[field])
	}

	if got != want {
		t.Fatalf("payload[%q] = %q, want %q", field, got, want)
	}
}

func waitForRelaySubscription(t *testing.T, relay *stubRelay, boardID string) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		relay.mu.Lock()
		_, ok := relay.subs[boardID]
		relay.mu.Unlock()
		if ok {
			return
		}

		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("relay subscription for %s never registered", boardID)
}
