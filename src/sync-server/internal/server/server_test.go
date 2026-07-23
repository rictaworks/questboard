package server_test

import (
	"context"
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
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
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

func TestMetricsExposeWebSocketConnections(t *testing.T) {
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

	assertMetric := func(want int64) {
		t.Helper()

		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			response, err := http.Get(httpServer.URL + "/metrics")
			if err != nil {
				t.Fatalf("GET /metrics error = %v", err)
			}

			body, readErr := io.ReadAll(response.Body)
			_ = response.Body.Close()
			if readErr != nil {
				t.Fatalf("reading /metrics body failed: %v", readErr)
			}

			var metrics map[string]int64
			if err := json.Unmarshal(body, &metrics); err != nil {
				t.Fatalf("decoding /metrics body failed: %v", err)
			}

			if metrics["websocket_connections"] == want {
				return
			}

			time.Sleep(25 * time.Millisecond)
		}

		t.Fatalf("GET /metrics websocket_connections did not reach %d", want)
	}

	assertMetric(0)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	assertMetric(1)

	if err := conn.Close(); err != nil {
		t.Fatalf("closing websocket connection failed: %v", err)
	}

	assertMetric(0)
}

func TestWebSocketMessageSizeLimit(t *testing.T) {
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

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	// MaxMessageSize is 512KB. Send a message slightly larger (513KB)
	largeMessage := make([]byte, ws.MaxMessageSize+1024)
	if err := conn.WriteMessage(websocket.BinaryMessage, largeMessage); err != nil {
		t.Fatalf("websocket write large message failed: %v", err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(1 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}

	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatal("expected error when reading oversized message, got nil")
	}

	var closeErr *websocket.CloseError
	if !errors.As(err, &closeErr) || closeErr.Code != websocket.CloseMessageTooBig {
		t.Fatalf("websocket read error = %v, want CloseError code %d (CloseMessageTooBig)", err, websocket.CloseMessageTooBig)
	}
}

func TestWebSocketOriginValidation(t *testing.T) {
	t.Parallel()

	app, err := server.New(config.Config{
		Address:        ":0",
		ShardCount:     2,
		AllowedOrigins: []string{"https://allowed.example"},
	})
	if err != nil {
		t.Fatalf("server.New() error = %v", err)
	}

	httpServer := httptest.NewServer(app.Engine())
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"

	disallowedHeader := http.Header{}
	disallowedHeader.Set("Origin", "https://evil.example")
	if _, _, err := websocket.DefaultDialer.Dial(wsURL, disallowedHeader); err == nil {
		t.Fatal("websocket dial with disallowed Origin succeeded, want rejection")
	}

	allowedHeader := http.Header{}
	allowedHeader.Set("Origin", "https://allowed.example")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, allowedHeader)
	if err != nil {
		t.Fatalf("websocket dial with allowed Origin failed: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})
}

func TestGracefulShutdownClosesWebSocketConnections(t *testing.T) {
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

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-123"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket dial failed: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.Close()
	})

	shutdownDone := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		shutdownDone <- app.Shutdown(ctx)
	}()

	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline() error = %v", err)
	}

	_, _, err = conn.ReadMessage()
	var closeErr *websocket.CloseError
	if !errors.As(err, &closeErr) || closeErr.Code != websocket.CloseGoingAway {
		t.Fatalf("websocket read error = %v, want CloseError code %d (CloseGoingAway)", err, websocket.CloseGoingAway)
	}

	if err := <-shutdownDone; err != nil {
		t.Fatalf("app.Shutdown() error = %v", err)
	}
}
