package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/server"
	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

const shutdownTimeout = 10 * time.Second

type developmentAuthenticator struct{}

func (developmentAuthenticator) Authenticate(ctx context.Context, boardID string, token string) (*ws.AuthContext, error) {
	return &ws.AuthContext{UserID: "dev-user", Role: "owner"}, nil
}

type developmentAuthorizer struct{}

func (developmentAuthorizer) Allow(ctx context.Context, auth *ws.AuthContext, op ws.Op) (bool, error) {
	return true, nil
}

type developmentStore struct{}

func (developmentStore) SaveConfirmedOp(ctx context.Context, op ws.Op) (ws.Op, bool, error) {
	return op, false, nil
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

	if cfg.Env == "production" {
		wsHandler.SetAuthenticator(ws.NewRailsAPIClient(cfg.BackendURL))
		wsHandler.SetAuthorizer(ws.RailsAuthorizer{})
		wsHandler.SetStore(ws.NewRailsStore(cfg.BackendURL))
	} else {
		wsHandler.SetAuthenticator(developmentAuthenticator{})
		wsHandler.SetAuthorizer(developmentAuthorizer{})
		wsHandler.SetStore(developmentStore{})
	}

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
