package server

import (
	"fmt"

	"github.com/gin-gonic/gin"

	"github.com/rictaworks/questboard/src/sync-server/internal/config"
	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

type Server struct {
	engine *gin.Engine
	addr   string
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

	return &Server{
		engine: engine,
		addr:   cfg.Address,
	}, nil
}

func (s *Server) Engine() *gin.Engine {
	return s.engine
}

func (s *Server) Run() error {
	if err := s.engine.Run(s.addr); err != nil {
		return fmt.Errorf("run sync server: %w", err)
	}

	return nil
}

func healthHandler(ctx *gin.Context) {
	ctx.JSON(200, gin.H{
		"status": "ok",
	})
}
