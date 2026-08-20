package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/server"
	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

func newServerForHeaders(t *testing.T, env string) *httptest.Server {
	t.Helper()

	router, err := sharding.NewRouter(1)
	if err != nil {
		t.Fatalf("sharding.NewRouter() error = %v", err)
	}

	wsHandler := ws.NewHandler(router, nil)
	cfg := config.Config{Address: ":0", ShardCount: 1, Env: env}
	if env == "production" {
		// production では metrics トークンが必須（issue #229）
		cfg.MetricsToken = "s3cret-metrics-token"
		wsHandler.SetAuthenticator(allowAllAuthenticator{})
		wsHandler.SetAuthorizer(allowAllAuthorizer{})
		wsHandler.SetStore(noopStore{})
	}

	app, err := server.New(cfg, wsHandler)
	if err != nil {
		t.Fatalf("server.New() error = %v", err)
	}
	setupMockHandler(app)

	httpServer := httptest.NewServer(app.Engine())
	t.Cleanup(httpServer.Close)

	return httpServer
}

// 全応答にセキュリティヘッダが付く（issue #240 で一つも返していなかった）
func TestSecurityHeadersOnEveryResponse(t *testing.T) {
	httpServer := newServerForHeaders(t, "")

	response, err := http.Get(httpServer.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz error = %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
	}
	for name, expected := range want {
		if got := response.Header.Get(name); got != expected {
			t.Errorf("%s = %q, want %q", name, got, expected)
		}
	}
}

// HSTS は production のみ。開発時の http://localhost に付けると、ブラウザが
// そのホストへの HTTPS を記憶して手元の平文アクセスが壊れる
func TestStrictTransportSecurityOnlyInProduction(t *testing.T) {
	development := newServerForHeaders(t, "")
	response, err := http.Get(development.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz error = %v", err)
	}
	_ = response.Body.Close()

	if got := response.Header.Get("Strict-Transport-Security"); got != "" {
		t.Errorf("development の HSTS = %q, want 空", got)
	}

	production := newServerForHeaders(t, "production")
	response, err = http.Get(production.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz error = %v", err)
	}
	_ = response.Body.Close()

	if got := response.Header.Get("Strict-Transport-Security"); !strings.Contains(got, "max-age=") {
		t.Errorf("production の HSTS = %q, want max-age を含む", got)
	}
}

// ヘッダを足したことで WebSocket の握手が壊れていないこと。
// ミドルウェアは Upgrade より前に応答ヘッダへ書き込むため、101 応答の
// 生成に影響しうる
func TestWebSocketStillUpgradesWithSecurityHeaders(t *testing.T) {
	httpServer := newServerForHeaders(t, "")

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws?boardId=board-headers"
	conn, response, err := websocket.DefaultDialer.Dial(wsURL, makeHeaderForURL(t, wsURL))
	if err != nil {
		t.Fatalf("WebSocket の接続に失敗した: %v", err)
	}
	defer func() { _ = conn.Close() }()

	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("握手の応答 = %d, want %d", response.StatusCode, http.StatusSwitchingProtocols)
	}
}
