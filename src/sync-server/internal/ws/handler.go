package ws

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"github.com/rictaworks/questboard/src/sync-server/internal/sharding"
)

type Handler struct {
	router   *sharding.Router
	upgrader websocket.Upgrader
}

func NewHandler(router *sharding.Router, allowedOrigins []string) *Handler {
	return &Handler{
		router: router,
		upgrader: websocket.Upgrader{
			CheckOrigin: newOriginChecker(allowedOrigins),
		},
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

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
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
