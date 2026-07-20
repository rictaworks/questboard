package server_test

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/server"
)

func TestHealthAndWebSocketConnection(t *testing.T) {
	t.Parallel()

	app, err := server.New(config.Config{
		Address:    ":0",
		ShardCount: 2,
	})
	if err != nil {
		t.Fatalf("server.New() error = %v", err)
	}

	httpServer := httptest.NewServer(app.Engine())
	t.Cleanup(httpServer.Close)

	healthResponse, err := http.Get(httpServer.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz error = %v", err)
	}
	t.Cleanup(func() {
		_ = healthResponse.Body.Close()
	})

	if healthResponse.StatusCode != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want %d", healthResponse.StatusCode, http.StatusOK)
	}

	healthBody, err := io.ReadAll(healthResponse.Body)
	if err != nil {
		t.Fatalf("reading /healthz body failed: %v", err)
	}

	var healthPayload map[string]string
	if err := json.Unmarshal(healthBody, &healthPayload); err != nil {
		t.Fatalf("decoding /healthz body failed: %v", err)
	}

	if healthPayload["status"] != "ok" {
		t.Fatalf("GET /healthz body = %v, want status ok", healthPayload)
	}

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	if err := conn.WriteMessage(websocket.TextMessage, []byte("noop")); err != nil {
		t.Fatalf("websocket write failed: %v", err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}

	_, _, err = conn.ReadMessage()
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
			t.Fatalf("websocket read error = %v, want timeout or clean close", err)
		}
	}
}
