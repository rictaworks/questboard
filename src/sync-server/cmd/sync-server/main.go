package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/originmatch"
	"github.com/rictaworks/questboard/src/sync-server/internal/server"
	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

const shutdownTimeout = 10 * time.Second

// railsWiring は認証・認可・永続化の3点を Rails 連携で束ねて返す。
// 環境を問わずこの配線を使う：以前は非本番で no-op のストア・認証が配線されており、
// WS 経由の op（移動・色変更・削除・テキスト編集）が一切 Rails に永続化されず、
// リロードで削除が復活する／KPIイベント・クエストが進まない不具合があった（issue #197）。
func railsWiring(backendURL string) (ws.Authenticator, ws.Authorizer, ws.Store) {
	return ws.NewRailsAPIClient(backendURL), ws.RailsAuthorizer{}, ws.NewRailsStore(backendURL)
}

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatal(err)
	}

	router, err := sharding.NewRouter(cfg.ShardCount)
	if err != nil {
		log.Fatal(err)
	}

	wsHandler := ws.NewHandler(router, cfg.AllowedOrigins)

	if cfg.Env != "production" {
		// フロント（src/lib/backend-url.ts）・Rails（development_allowed_origins.rb）と
		// 同じ問題：Codespacesの転送URL越しに開いたフロントのOriginは、Sync-server自身の
		// 転送ドメインとは別（ポートごとに別サブドメイン）なので、静的な許可リストにも
		// 同一Hostフォールバックにも一致しない。
		developmentPattern, err := originmatch.DevelopmentPattern(cfg.CodespaceName, cfg.CodespacesForwardingDomain)
		if err != nil {
			log.Fatal(err)
		}
		wsHandler.SetDevelopmentOriginPattern(developmentPattern)
	}

	authenticator, authorizer, store := railsWiring(cfg.BackendURL)
	wsHandler.SetAuthenticator(authenticator)
	wsHandler.SetAuthorizer(authorizer)
	wsHandler.SetStore(store)

	app, err := server.New(cfg, wsHandler)
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- app.Run()
	}()

	select {
	case err := <-serveErr:
		if err != nil {
			log.Fatal(err)
		}
	case <-ctx.Done():
		stop()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()

		if err := app.Shutdown(shutdownCtx); err != nil {
			log.Fatal(err)
		}
	}
}
