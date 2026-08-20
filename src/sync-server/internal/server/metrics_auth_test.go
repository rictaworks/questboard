package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/server"
	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

// newMetricsServer boots a server with the given /metrics token and returns a live test
// server for it.
func newMetricsServer(t *testing.T, token string) *httptest.Server {
	t.Helper()

	router, err := sharding.NewRouter(1)
	if err != nil {
		t.Fatalf("sharding.NewRouter() error = %v", err)
	}

	wsHandler := ws.NewHandler(router, nil)
	app, err := server.New(config.Config{
		Address:      ":0",
		ShardCount:   1,
		MetricsToken: token,
	}, wsHandler)
	if err != nil {
		t.Fatalf("server.New() error = %v", err)
	}
	setupMockHandler(app)

	httpServer := httptest.NewServer(app.Engine())
	t.Cleanup(httpServer.Close)

	return httpServer
}

func getMetrics(t *testing.T, baseURL string, authorization string) int {
	t.Helper()

	request, err := http.NewRequest(http.MethodGet, baseURL+"/metrics", nil)
	if err != nil {
		t.Fatalf("building /metrics request failed: %v", err)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET /metrics error = %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	return response.StatusCode
}

// 開発環境ではトークン未設定で従来どおり読める（ローカル・CI が設定なしで scrape できる）
func TestMetricsWithoutTokenStaysOpen(t *testing.T) {
	httpServer := newMetricsServer(t, "")

	if status := getMetrics(t, httpServer.URL, ""); status != http.StatusOK {
		t.Fatalf("GET /metrics status = %d, want %d", status, http.StatusOK)
	}
}

// トークン設定時は正しい Bearer のみ通す。issue #229 で本番が無認証公開されていた
func TestMetricsRequiresBearerTokenWhenConfigured(t *testing.T) {
	const token = "s3cret-metrics-token"

	httpServer := newMetricsServer(t, token)

	testCases := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "ヘッダ無し", authorization: "", wantStatus: http.StatusUnauthorized},
		{name: "誤ったトークン", authorization: "Bearer wrong-token", wantStatus: http.StatusUnauthorized},
		{name: "Bearer 以外のスキーム", authorization: "Basic " + token, wantStatus: http.StatusUnauthorized},
		{name: "スキーム無しで値だけ", authorization: token, wantStatus: http.StatusUnauthorized},
		// 前方一致でトークンを1文字ずつ推測できないこと（定数時間比較の意図を固定する）
		{name: "先頭一致する短いトークン", authorization: "Bearer " + token[:5], wantStatus: http.StatusUnauthorized},
		{name: "正しいトークン", authorization: "Bearer " + token, wantStatus: http.StatusOK},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			status := getMetrics(t, httpServer.URL, testCase.authorization)
			if status != testCase.wantStatus {
				t.Fatalf("GET /metrics status = %d, want %d", status, testCase.wantStatus)
			}
		})
	}
}

// /healthz は外形監視から叩くため、トークン設定時も認証をかけない
func TestHealthzStaysUnauthenticatedWhenMetricsTokenSet(t *testing.T) {
	httpServer := newMetricsServer(t, "s3cret-metrics-token")

	response, err := http.Get(httpServer.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz error = %v", err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want %d", response.StatusCode, http.StatusOK)
	}
}

// 本番でトークン未設定なら起動を拒否する。素通し状態で本番に出ることを防ぐ
func TestProductionRequiresMetricsToken(t *testing.T) {
	router, err := sharding.NewRouter(1)
	if err != nil {
		t.Fatalf("sharding.NewRouter() error = %v", err)
	}

	wsHandler := ws.NewHandler(router, nil)
	wsHandler.SetAuthenticator(allowAllAuthenticator{})
	wsHandler.SetAuthorizer(allowAllAuthorizer{})
	wsHandler.SetStore(noopStore{})

	_, err = server.New(config.Config{
		Address:        ":0",
		ShardCount:     1,
		Env:            "production",
		AllowedOrigins: []string{"https://questboard.rictaworks.jp"},
	}, wsHandler)
	if err == nil {
		t.Fatal("server.New() error = nil, want SYNC_SERVER_METRICS_TOKEN required")
	}
	if !strings.Contains(err.Error(), "SYNC_SERVER_METRICS_TOKEN") {
		t.Fatalf("server.New() error = %v, want it to name SYNC_SERVER_METRICS_TOKEN", err)
	}
}
