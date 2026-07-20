package ws

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
)

const (
	// MaxMessageSize defines the maximum size limit for incoming WebSocket messages (512 KB).
	MaxMessageSize = 512 * 1024
	// PongWait is the maximum time allowed to read the next pong message from the peer.
	PongWait = 60 * time.Second
	// PingPeriod is the period for sending pings to peer. Must be less than PongWait.
	PingPeriod = (PongWait * 9) / 10
	// WriteWait is the maximum time allowed to write a message to the peer.
	WriteWait = 10 * time.Second
)

type Handler struct {
	router    *sharding.Router
	upgrader  websocket.Upgrader
	readLimit int64
}

func NewHandler(router *sharding.Router, allowedOrigins []string) *Handler {
	return &Handler{
		router: router,
		upgrader: websocket.Upgrader{
			CheckOrigin: newOriginChecker(allowedOrigins),
		},
		readLimit: MaxMessageSize,
	}
}

func (h *Handler) ServeHTTP(ctx *gin.Context) {
	boardID := ctx.Query("boardId")

	if _, err := h.router.Resolve(boardID); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	conn, err := h.upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": "websocket upgrade failed",
		})
		return
	}
	defer conn.Close()

	conn.SetReadLimit(h.readLimit)
	_ = conn.SetReadDeadline(time.Now().Add(PongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(PongWait))
		return nil
	})

	ticker := time.NewTicker(PingPeriod)
	defer ticker.Stop()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(PongWait))
		}
	}()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(WriteWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func newOriginChecker(allowedOrigins []string) func(*http.Request) bool {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[strings.ToLower(strings.TrimSpace(origin))] = struct{}{}
	}

	return func(request *http.Request) bool {
		origin := strings.ToLower(strings.TrimSpace(request.Header.Get("Origin")))
		if origin == "" {
			return true
		}

		if len(allowed) > 0 {
			_, ok := allowed[origin]
			return ok
		}

		parsedOrigin, err := url.Parse(origin)
		if err != nil {
			return false
		}

		return strings.EqualFold(parsedOrigin.Host, request.Host)
	}
}
