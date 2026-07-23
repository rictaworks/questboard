package ws

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
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
	router     *sharding.Router
	upgrader   websocket.Upgrader
	readLimit  int64
	hub        *Hub
	metrics    *Metrics
	authorizer Authorizer
	store      Store
	relay      Relay
	nodeID     string

	mu            sync.Mutex
	closing       bool
	closeCh       chan struct{}
	conns         sync.WaitGroup
	subscriptions map[string]context.CancelFunc
}

func NewHandler(router *sharding.Router, allowedOrigins []string) *Handler {
	return &Handler{
		router: router,
		upgrader: websocket.Upgrader{
			CheckOrigin: newOriginChecker(allowedOrigins),
		},
		readLimit:     MaxMessageSize,
		hub:           NewHub(),
		metrics:       NewMetrics(),
		authorizer:    allowAllAuthorizer{},
		store:         noopStore{},
		closeCh:       make(chan struct{}),
		subscriptions: make(map[string]context.CancelFunc),
		nodeID:        "sync-server-local",
	}
}

type Authorizer interface {
	Allow(ctx context.Context, op Op) (bool, error)
}

type Store interface {
	SaveConfirmedOp(ctx context.Context, op Op) error
}

type allowAllAuthorizer struct{}

func (allowAllAuthorizer) Allow(context.Context, Op) (bool, error) {
	return true, nil
}

type noopStore struct{}

func (noopStore) SaveConfirmedOp(context.Context, Op) error {
	return nil
}

func (h *Handler) SetAuthorizer(authorizer Authorizer) {
	if authorizer != nil {
		h.authorizer = authorizer
	}
}

func (h *Handler) SetStore(store Store) {
	if store != nil {
		h.store = store
	}
}

func (h *Handler) SetRelay(relay Relay) {
	h.relay = relay
}

func (h *Handler) SetNodeID(nodeID string) {
	if strings.TrimSpace(nodeID) != "" {
		h.nodeID = strings.TrimSpace(nodeID)
	}
}

func (h *Handler) MetricsSnapshot() map[string]int64 {
	return h.metrics.Snapshot()
}

// Shutdown stops the handler from accepting new connections and signals every
// active connection to close. It does not block; call Wait afterward to block
// until connections have finished closing.
func (h *Handler) Shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closing {
		return
	}

	h.closing = true
	for boardID, cancel := range h.subscriptions {
		cancel()
		delete(h.subscriptions, boardID)
	}
	if h.relay != nil {
		_ = h.relay.Close()
	}
	close(h.closeCh)
}

// Wait blocks until every connection registered before Shutdown was called
// has closed, or ctx is done, whichever happens first.
func (h *Handler) Wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.conns.Wait()
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// acquire registers a new connection attempt, unless Shutdown has already
// been called. The check and the WaitGroup increment happen atomically under
// h.mu so a connection can never register after Wait has observed zero active
// connections.
func (h *Handler) acquire() bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closing {
		return false
	}

	h.conns.Add(1)
	return true
}

func (h *Handler) ServeHTTP(ctx *gin.Context) {
	if !h.acquire() {
		ctx.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "server shutting down",
		})
		return
	}
	defer h.conns.Done()

	boardID := ctx.Query("boardId")

	target, err := h.router.Resolve(boardID)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	conn, err := h.upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		// The upgrader already wrote its own error response (e.g. a 403 for a
		// rejected Origin) directly to ctx.Writer before returning err, so only
		// write a fallback response if it hasn't written one.
		if !ctx.Writer.Written() {
			ctx.JSON(http.StatusBadRequest, gin.H{
				"error": "websocket upgrade failed",
			})
		}
		return
	}
	defer conn.Close()

	client := &client{send: make(chan []byte, 32), done: make(chan struct{})}
	h.hub.Register(boardID, client)
	h.metrics.IncWebSocketConnections()
	defer func() {
		close(client.done)
		h.metrics.DecWebSocketConnections()
		h.hub.Unregister(boardID, client)
	}()

	if err := h.ensureRelaySubscription(ctx.Request.Context(), boardID); err != nil {
		_ = writeClose(conn, websocket.CloseInternalServerErr, err.Error())
		return
	}

	writerDone := make(chan struct{})
	go h.writePump(conn, client, writerDone)

	incoming := make(chan []byte, 1)
	readErr := make(chan error, 1)
	go func() {
		defer close(incoming)
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				readErr <- err
				return
			}

			select {
			case incoming <- raw:
			case <-h.closeCh:
				return
			}
		}
	}()

	conn.SetReadLimit(h.readLimit)
	_ = conn.SetReadDeadline(time.Now().Add(PongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(PongWait))
		return nil
	})

	for {
		select {
		case <-h.closeCh:
			_ = writeClose(conn, websocket.CloseGoingAway, "server shutting down")
			return
		case err := <-readErr:
			if err != nil {
				return
			}
		case raw, ok := <-incoming:
			if !ok {
				return
			}

			op, err := ParseOp(raw)
			if err != nil {
				_ = writeClose(conn, websocket.CloseUnsupportedData, err.Error())
				return
			}

			if err := op.Validate(target.BoardID); err != nil {
				_ = writeClose(conn, websocket.ClosePolicyViolation, err.Error())
				return
			}

			allowed, err := h.authorizer.Allow(ctx.Request.Context(), op)
			if err != nil {
				_ = writeClose(conn, websocket.CloseInternalServerErr, err.Error())
				return
			}
			if !allowed {
				_ = writeClose(conn, websocket.ClosePolicyViolation, "op rejected by permission check")
				return
			}

			if err := h.store.SaveConfirmedOp(ctx.Request.Context(), op); err != nil {
				_ = writeClose(conn, websocket.CloseInternalServerErr, err.Error())
				return
			}

			payload, err := op.MarshalJSON()
			if err != nil {
				_ = writeClose(conn, websocket.CloseInternalServerErr, err.Error())
				return
			}

			h.hub.Broadcast(boardID, payload)

			if h.relay != nil {
				if err := h.relay.Publish(ctx.Request.Context(), op); err != nil {
					_ = writeClose(conn, websocket.CloseInternalServerErr, err.Error())
					return
				}
			}
		}
	}
}

func (h *Handler) writePump(conn *websocket.Conn, client *client, done chan<- struct{}) {
	defer close(done)

	ticker := time.NewTicker(PingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-client.done:
			_ = writeClose(conn, websocket.CloseNormalClosure, "connection closed")
			return
		case payload, ok := <-client.send:
			if !ok {
				_ = writeClose(conn, websocket.CloseNormalClosure, "connection closed")
				return
			}

			_ = conn.SetWriteDeadline(time.Now().Add(WriteWait))
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(WriteWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Handler) ensureRelaySubscription(ctx context.Context, boardID string) error {
	if h.relay == nil {
		return nil
	}

	h.mu.Lock()
	if _, ok := h.subscriptions[boardID]; ok {
		h.mu.Unlock()
		return nil
	}

	subCtx, cancel := context.WithCancel(context.Background())
	h.subscriptions[boardID] = cancel
	h.mu.Unlock()

	ops, unsubscribe, err := h.relay.Subscribe(subCtx, boardID)
	if err != nil {
		cancel()
		h.mu.Lock()
		delete(h.subscriptions, boardID)
		h.mu.Unlock()
		return err
	}

	go func() {
		defer unsubscribe()
		for {
			select {
			case <-ctx.Done():
				return
			case op, ok := <-ops:
				if !ok {
					return
				}

				if op.BoardID != boardID {
					continue
				}

				payload, err := op.MarshalJSON()
				if err != nil {
					continue
				}

				h.hub.Broadcast(boardID, payload)
			}
		}
	}()

	return nil
}

func writeClose(conn *websocket.Conn, code int, text string) error {
	_ = conn.SetWriteDeadline(time.Now().Add(WriteWait))
	message := websocket.FormatCloseMessage(code, text)
	return conn.WriteMessage(websocket.CloseMessage, message)
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
