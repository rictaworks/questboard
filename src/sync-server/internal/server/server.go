package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

type Server struct {
	engine     *gin.Engine
	httpServer *http.Server
	wsHandler  *ws.Handler
}

func New(cfg config.Config) (*Server, error) {
	router, err := sharding.NewRouter(cfg.ShardCount)
	if err != nil {
		return nil, err
	}

	wsHandler := ws.NewHandler(router, cfg.AllowedOrigins)
	wsHandler.SetNodeID(cfg.NodeID)
	if cfg.RedisURL != "" {
		relay, err := ws.NewRedisRelay(cfg.RedisURL, cfg.RedisChannelPrefix, cfg.NodeID)
		if err != nil {
			return nil, err
		}
		wsHandler.SetRelay(relay)
	}

	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.GET("/healthz", healthHandler)
	engine.GET("/metrics", func(ctx *gin.Context) {
		ctx.JSON(http.StatusOK, wsHandler.MetricsSnapshot())
	})
	engine.GET("/ws", wsHandler.ServeHTTP)

	httpServer := &http.Server{
		Addr:              cfg.Address,
		Handler:           engine,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MB
	}

	return &Server{
		engine:     engine,
		httpServer: httpServer,
		wsHandler:  wsHandler,
	}, nil
}

func (s *Server) Engine() *gin.Engine {
	return s.engine
}

func (s *Server) Run() error {
	if err := s.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("run sync server: %w", err)
	}

	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	httpErr := s.httpServer.Shutdown(ctx)

	s.wsHandler.Shutdown()
	waitErr := s.wsHandler.Wait(ctx)

	if httpErr != nil || waitErr != nil {
		return fmt.Errorf("shutdown sync server: %w", errors.Join(httpErr, waitErr))
	}

	return nil
}

func healthHandler(ctx *gin.Context) {
	ctx.JSON(200, gin.H{
		"status": "ok",
	})
}
