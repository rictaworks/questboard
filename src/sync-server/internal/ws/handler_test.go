package ws_test

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
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

type allowAllAuthenticator struct{}

func (allowAllAuthenticator) Authenticate(ctx context.Context, boardID string, token string) (*ws.AuthContext, error) {
	return &ws.AuthContext{UserID: "test-user", Role: "owner"}, nil
}

// callCountingAuthenticator records how many times Authenticate was invoked, so tests can
// prove a disallowed-origin request never reaches the backend authentication call (which
// would otherwise let an attacker amplify one WS connection attempt into extra Rails
// requests regardless of Origin).
type callCountingAuthenticator struct {
	calls int32
}

func (a *callCountingAuthenticator) Authenticate(ctx context.Context, boardID string, token string) (*ws.AuthContext, error) {
	atomic.AddInt32(&a.calls, 1)
	return &ws.AuthContext{UserID: "test-user", Role: "owner"}, nil
}

type allowAllAuthorizer struct{}

func (allowAllAuthorizer) Allow(ctx context.Context, auth *ws.AuthContext, op ws.Op) (bool, error) {
	return true, nil
}

type noopStore struct{}

func (noopStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, error) {
	return op, nil
}

type presenceTrapStore struct {
	calls int32
}

func (s *presenceTrapStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, error) {
	atomic.AddInt32(&s.calls, 1)
	return op, nil
}

type staleOpStore struct{}

func (staleOpStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, error) {
	return ws.Op{}, ws.ErrStaleOp
}

type unsupportedPropertyStore struct{}

func (unsupportedPropertyStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, error) {
	return ws.Op{}, ws.ErrUnsupportedOpProperty
}

// persistedValueStore simulates a backend that normalizes/coerces the submitted value
// (e.g. Rails ignoring an invalid field or rewriting it) instead of persisting the
// client's raw value verbatim. It returns the op with Value swapped out so tests can
// assert the handler broadcasts what was actually persisted, not what the client sent.
type persistedValueStore struct {
	persistedValue json.RawMessage
}

func (s persistedValueStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, error) {
	op.Value = s.persistedValue
	return op, nil
}

func TestConfirmedOpsBroadcastToSameBoardConnections(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(noopStore{})

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

func TestStaleOpsAreNotBroadcastAndConnectionStaysOpen(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(staleOpStore{})

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-stale"
	connA := mustDialWebSocket(t, wsURL)
	defer connA.Close()
	connB := mustDialWebSocket(t, wsURL)
	defer connB.Close()

	op := map[string]any{
		"boardId":    "board-stale",
		"objectId":   "object-1",
		"property":   "geometry",
		"value":      map[string]any{"x": 20, "y": 40},
		"lamport_ts": 1,
		"clientId":   "client-a",
	}
	mustWriteJSON(t, connA, op)

	// connB must never receive a broadcast for a stale/rejected op.
	if err := connB.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}
	if _, _, err := connB.ReadMessage(); err == nil {
		t.Fatal("connB received a message for a stale op, want no broadcast")
	} else if netErr, ok := err.(net.Error); !ok || !netErr.Timeout() {
		t.Fatalf("connB read error = %v, want a read timeout", err)
	}

	// connA's connection must remain open (not closed as an internal server error) since
	// a rejected stale op is an expected outcome, not a client bug.
	if err := connA.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}
	if _, _, err := connA.ReadMessage(); err == nil {
		t.Fatal("connA received an unexpected message")
	} else if netErr, ok := err.(net.Error); !ok || !netErr.Timeout() {
		t.Fatalf("connA read error = %v, want a read timeout (connection should stay open)", err)
	}
}

func TestUnsupportedPropertyOpsAreNotBroadcastAndCloseTheConnection(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(unsupportedPropertyStore{})

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-unsupported"
	connA := mustDialWebSocket(t, wsURL)
	defer connA.Close()
	connB := mustDialWebSocket(t, wsURL)
	defer connB.Close()

	op := map[string]any{
		"boardId":    "board-unsupported",
		"objectId":   "object-1",
		"property":   "text_crdt",
		"value":      map[string]any{"ops": []any{}},
		"lamport_ts": 1,
		"clientId":   "client-a",
	}
	mustWriteJSON(t, connA, op)

	// connB must never receive a broadcast for an op the backend cannot persist.
	if err := connB.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}
	if _, _, err := connB.ReadMessage(); err == nil {
		t.Fatal("connB received a message for an unsupported-property op, want no broadcast")
	} else if netErr, ok := err.(net.Error); !ok || !netErr.Timeout() {
		t.Fatalf("connB read error = %v, want a read timeout", err)
	}

	// connA should be closed with CloseUnsupportedData since this is a protocol mismatch,
	// not a transient/expected condition like a stale op.
	if err := connA.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}
	_, _, err = connA.ReadMessage()
	var closeErr *websocket.CloseError
	if !errors.As(err, &closeErr) || closeErr.Code != websocket.CloseUnsupportedData {
		t.Fatalf("connA read error = %v, want CloseError code %d (CloseUnsupportedData)", err, websocket.CloseUnsupportedData)
	}
}

func TestDisallowedOriginIsRejectedBeforeAuthentication(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	authenticator := &callCountingAuthenticator{}

	handler := ws.NewHandler(router, []string{"https://allowed.example"})
	handler.SetAuthenticator(authenticator)
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(noopStore{})

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	req, err := http.NewRequest(http.MethodGet, httpServer.URL+"/ws?boardId=board-1", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Authorization", "Bearer test-token")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}

	if calls := atomic.LoadInt32(&authenticator.calls); calls != 0 {
		t.Fatalf("authenticator.Authenticate called %d times, want 0 — origin must be rejected before any backend authentication request", calls)
	}
}

func TestConfirmedOpBroadcastsPersistedValueNotClientValue(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	// The backend is free to normalize/ignore parts of a submitted value (e.g. Rails
	// coercing an invalid geometry field or ignoring an op's value entirely for
	// deleted_at). Broadcasting the client's raw input instead of what was actually
	// persisted would let connected clients drift from the confirmed backend state.
	persistedValue := json.RawMessage(`{"x":20,"y":40,"w":100,"h":50,"rotation":0}`)
	store := persistedValueStore{persistedValue: persistedValue}

	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(store)

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-persisted"
	connA := mustDialWebSocket(t, wsURL)
	defer connA.Close()
	connB := mustDialWebSocket(t, wsURL)
	defer connB.Close()

	op := map[string]any{
		"boardId":    "board-persisted",
		"objectId":   "object-1",
		"property":   "geometry",
		"value":      map[string]any{"x": 20, "y": "not-a-number"},
		"lamport_ts": 1,
		"clientId":   "client-a",
	}
	mustWriteJSON(t, connA, op)

	got := mustReadJSONMessage(t, connB)

	gotValue, err := json.Marshal(got["value"])
	if err != nil {
		t.Fatalf("marshal received value failed: %v", err)
	}

	var gotNormalized, wantNormalized any
	if err := json.Unmarshal(gotValue, &gotNormalized); err != nil {
		t.Fatalf("unmarshal received value failed: %v", err)
	}
	if err := json.Unmarshal(persistedValue, &wantNormalized); err != nil {
		t.Fatalf("unmarshal persisted value failed: %v", err)
	}

	gotJSON, _ := json.Marshal(gotNormalized)
	wantJSON, _ := json.Marshal(wantNormalized)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("broadcast value = %s, want persisted value %s (not the client's raw input)", gotJSON, wantJSON)
	}
}

func TestRedisRelayBroadcastsRemoteOps(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(noopStore{})

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

func TestPresenceOpsBroadcastWithoutPersistenceAndAreThrottled(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	store := &presenceTrapStore{}
	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(store)

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-presence"
	connA := mustDialWebSocket(t, wsURL)
	defer connA.Close()
	connB := mustDialWebSocket(t, wsURL)
	defer connB.Close()

	presence := map[string]any{
		"boardId":    "board-presence",
		"objectId":   "object-1",
		"property":   "presence",
		"value":      map[string]any{"cursor": map[string]any{"x": 10, "y": 20}},
		"lamport_ts": 1,
		"clientId":   "client-a",
	}
	mustWriteJSON(t, connA, presence)

	got := mustReadJSONMessage(t, connB)
	assertJSONField(t, got, "property", "presence")
	assertJSONField(t, got, "clientId", "client-a")

	mustWriteJSON(t, connA, presence)

	if err := connB.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}
	if _, _, err := connB.ReadMessage(); err == nil {
		t.Fatal("connB received a throttled presence update, want no second broadcast")
	} else if netErr, ok := err.(net.Error); !ok || !netErr.Timeout() {
		t.Fatalf("connB read error = %v, want a read timeout", err)
	}

	if calls := atomic.LoadInt32(&store.calls); calls != 0 {
		t.Fatalf("presence op was persisted %d times, want 0", calls)
	}
}

func TestPresenceOpsRejectOversizedOrMalformedPayloads(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		payload string
	}{
		{
			name: "rejects oversized raw payloads",
			payload: `{"boardId":"board-presence","objectId":"object-1","property":"presence","value":{` +
				strings.Repeat(" ", ws.MaxPresenceValueBytes+64) +
				`"cursor":{` +
				strings.Repeat(" ", ws.MaxPresenceValueBytes+64) +
				`"x":10,` +
				strings.Repeat(" ", ws.MaxPresenceValueBytes+64) +
				`"y":20` +
				strings.Repeat(" ", ws.MaxPresenceValueBytes+64) +
				`}` +
				strings.Repeat(" ", ws.MaxPresenceValueBytes+64) +
				`},"lamport_ts":1,"clientId":"client-a"}`,
		},
		{
			name:    "rejects unsupported presence shape",
			payload: `{"boardId":"board-presence","objectId":"object-1","property":"presence","value":{"cursor":{"x":10,"y":20,"z":30}},"lamport_ts":1,"clientId":"client-a"}`,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			router, err := sharding.NewRouter(2)
			if err != nil {
				t.Fatalf("NewRouter() error = %v", err)
			}

			store := &presenceTrapStore{}
			handler := ws.NewHandler(router, nil)
			handler.SetAuthenticator(allowAllAuthenticator{})
			handler.SetAuthorizer(allowAllAuthorizer{})
			handler.SetStore(store)

			engine := gin.New()
			engine.GET("/ws", handler.ServeHTTP)
			httpServer := httptest.NewServer(engine)
			t.Cleanup(httpServer.Close)

			wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-presence"
			connA := mustDialWebSocket(t, wsURL)
			defer connA.Close()
			connB := mustDialWebSocket(t, wsURL)
			defer connB.Close()

			mustWriteRawMessage(t, connA, tt.payload)

			if err := connB.SetReadDeadline(time.Now().Add(300 * time.Millisecond)); err != nil {
				t.Fatalf("SetReadDeadline() error = %v", err)
			}
			if _, _, err := connB.ReadMessage(); err == nil {
				t.Fatal("connB received a broadcast for invalid presence, want no broadcast")
			} else if netErr, ok := err.(net.Error); !ok || !netErr.Timeout() {
				t.Fatalf("connB read error = %v, want a read timeout", err)
			}

			if err := connA.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
				t.Fatalf("SetReadDeadline() error = %v", err)
			}
			_, _, err = connA.ReadMessage()
			var closeErr *websocket.CloseError
			if !errors.As(err, &closeErr) || closeErr.Code != websocket.ClosePolicyViolation {
				t.Fatalf("connA read error = %v, want CloseError code %d (ClosePolicyViolation)", err, websocket.ClosePolicyViolation)
			}

			if calls := atomic.LoadInt32(&store.calls); calls != 0 {
				t.Fatalf("invalid presence op was persisted %d times, want 0", calls)
			}
		})
	}
}

func mustDialWebSocket(t *testing.T, wsURL string) *websocket.Conn {
	t.Helper()

	httpURL := strings.Replace(wsURL, "ws://", "http://", 1)
	httpURL = strings.Replace(httpURL, "wss://", "https://", 1)
	u, err := url.Parse(httpURL)
	if err != nil {
		t.Fatalf("parse wsURL failed: %v", err)
	}

	header := make(http.Header)
	header.Set("Origin", "http://"+u.Host)
	header.Set("Authorization", "Bearer test-token")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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

func mustWriteRawMessage(t *testing.T, conn *websocket.Conn, payload string) {
	t.Helper()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(payload)); err != nil {
		t.Fatalf("websocket raw write failed: %v", err)
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

type deletedObjectEditStore struct{}

func (deletedObjectEditStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, error) {
	return ws.Op{}, ws.ErrDeletedObjectEdit
}

func TestDeletedObjectEditSendsRecoveryNotification(t *testing.T) {
	t.Parallel()

	router, err := sharding.NewRouter(2)
	if err != nil {
		t.Fatalf("NewRouter() error = %v", err)
	}

	handler := ws.NewHandler(router, nil)
	handler.SetAuthenticator(allowAllAuthenticator{})
	handler.SetAuthorizer(allowAllAuthorizer{})
	handler.SetStore(deletedObjectEditStore{})

	engine := gin.New()
	engine.GET("/ws", handler.ServeHTTP)
	httpServer := httptest.NewServer(engine)
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"
	conn := mustDialWebSocket(t, wsURL)
	defer conn.Close()

	op := map[string]any{
		"boardId":    "board-123",
		"objectId":   "object-1",
		"property":   "geometry",
		"value":      map[string]any{"x": 20, "y": 40},
		"lamport_ts": 7,
		"clientId":   "client-a",
	}
	mustWriteJSON(t, conn, op)

	// 他のクライアントへのブロードキャストは行われないが、
	// 送信元のコネクションは維持されたまま、専用の復元提案メッセージが送られてくるはず
	got := mustReadJSONMessage(t, conn)
	assertJSONField(t, got, "objectId", "object-1")
	assertJSONField(t, got, "error", "Object has been deleted; restore it before editing")

	// restoreSuggested が boolean の true であることを検証
	val, ok := got["restoreSuggested"].(bool)
	if !ok || !val {
		t.Fatalf("expected restoreSuggested to be true, got %v", got["restoreSuggested"])
	}
}
