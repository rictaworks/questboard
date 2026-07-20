package server

import (
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
}

func New(cfg config.Config) (*Server, error) {
	router, err := sharding.NewRouter(cfg.ShardCount)
	if err != nil {
		return nil, err
	}

	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.GET("/healthz", healthHandler)
	engine.GET("/ws", ws.NewHandler(router, cfg.AllowedOrigins).ServeHTTP)

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
	}, nil
}

func (s *Server) Engine() *gin.Engine {
	return s.engine
}

func (s *Server) HTTPServer() *http.Server {
	return s.httpServer
}

func (s *Server) Run() error {
	if err := s.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("run sync server: %w", err)
	}

	return nil
}

func healthHandler(ctx *gin.Context) {
	ctx.JSON(200, gin.H{
		"status": "ok",
	})
}
