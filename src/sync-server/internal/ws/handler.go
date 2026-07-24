package ws

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	// PresenceBroadcastInterval caps cursor broadcasts at 30Hz.
	PresenceBroadcastInterval = time.Second / 30
	// MaxPresenceValueBytes keeps transient cursor payloads tiny so they cannot be used
	// as a broadcast/relay amplification vector.
	MaxPresenceValueBytes = 512

	// railsSessionCookieName must match config.session_store's `key:` in the Rails
	// backend (src/backend/config/application.rb). Rails authenticates solely via this
	// encrypted session cookie, so any other cookie/header name is silently ignored and
	// current_user resolves to nil.
	railsSessionCookieName = "_questboard_session"
)

// ErrStaleOp indicates the backend rejected an operation because a newer (or the same)
// Lamport-ordered operation was already recorded for the target object. Callers must not
// broadcast or relay an op that failed with ErrStaleOp, since doing so would let other
// clients apply an out-of-date value.
var ErrStaleOp = errors.New("stale or duplicate operation rejected")

// ErrDeletedObjectEdit indicates the operation was rejected because the object has been soft-deleted.
var ErrDeletedObjectEdit = errors.New("object has been deleted")

// ErrUnsupportedOpProperty indicates the store has no persistence path for this op's
// Property (for example a transient presence update). Treating this as success would
// broadcast a change to every connected client that the backend never actually saved, so
// it must never be silently swallowed.
var ErrUnsupportedOpProperty = errors.New("unsupported op property")

type DeletedObjectEditPayload struct {
	ObjectID         string `json:"objectId"`
	Error            string `json:"error"`
	RestoreSuggested bool   `json:"restoreSuggested"`
}

type AuthContext struct {
	UserID string
	Role   string
}

type Authenticator interface {
	Authenticate(ctx context.Context, boardID string, token string) (*AuthContext, error)
}

type Authorizer interface {
	Allow(ctx context.Context, auth *AuthContext, op Op) (bool, error)
}

// Store persists a confirmed op and returns the op as actually persisted. The returned
// Value must reflect whatever the backend normalized, coerced, or otherwise settled on —
// never the caller's raw input — since Handler broadcasts the returned Op to every other
// connected client as the confirmed state.
type Store interface {
	SaveConfirmedOp(ctx context.Context, op Op) (Op, error)
}

type contextKey string

const tokenKey contextKey = "authToken"

// ContextWithToken attaches an auth token to ctx the same way ServeHTTP does before
// calling Store.SaveConfirmedOp, so Store implementations (including RailsStore) can be
// exercised with a token present outside of a real WebSocket connection.
func ContextWithToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, tokenKey, token)
}

type RailsAPIClient struct {
	BackendURL string
}

func NewRailsAPIClient(backendURL string) *RailsAPIClient {
	return &RailsAPIClient{BackendURL: backendURL}
}

func (c *RailsAPIClient) Authenticate(ctx context.Context, boardID string, token string) (*AuthContext, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.BackendURL+"/session", nil)
	if err != nil {
		return nil, err
	}

	if token != "" {
		req.Header.Set("Cookie", railsSessionCookieName+"="+token)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("rails api request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("authentication failed with status %d", resp.StatusCode)
	}

	var sessionResp struct {
		Authenticated bool `json:"authenticated"`
		User          struct {
			ID          int    `json:"id"`
			DisplayName string `json:"displayName"`
		} `json:"user"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&sessionResp); err != nil {
		return nil, fmt.Errorf("decode rails response failed: %w", err)
	}

	if !sessionResp.Authenticated {
		return nil, fmt.Errorf("unauthenticated session")
	}

	boardReq, err := http.NewRequestWithContext(ctx, "GET", c.BackendURL+"/boards/"+boardID, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		boardReq.Header.Set("Cookie", railsSessionCookieName+"="+token)
	}

	boardResp, err := client.Do(boardReq)
	if err != nil {
		return nil, fmt.Errorf("rails api board request failed: %w", err)
	}
	defer boardResp.Body.Close()

	if boardResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("board access unauthorized with status %d", boardResp.StatusCode)
	}

	var boardData struct {
		Membership struct {
			UserID int `json:"userId"`
			Role   struct {
				Code string `json:"code"`
			} `json:"role"`
		} `json:"membership"`
	}

	if err := json.NewDecoder(boardResp.Body).Decode(&boardData); err != nil {
		return nil, fmt.Errorf("decode board data failed: %w", err)
	}

	return &AuthContext{
		UserID: fmt.Sprintf("%d", sessionResp.User.ID),
		Role:   boardData.Membership.Role.Code,
	}, nil
}

type RailsAuthorizer struct{}

func (RailsAuthorizer) Allow(ctx context.Context, auth *AuthContext, op Op) (bool, error) {
	if auth.Role == "owner" || auth.Role == "editor" {
		return true, nil
	}
	return false, nil
}

type RailsStore struct {
	BackendURL string
}

func NewRailsStore(backendURL string) *RailsStore {
	return &RailsStore{BackendURL: backendURL}
}

// opRequestPayload mirrors the JSON body accepted by the Rails
// `POST /boards/:share_token/objects/:id/ops` endpoint. LamportTS and ClientID let the
// backend reject stale or duplicate operations atomically (via object_ops' unique index
// on object_id+client_id+lamport_ts) instead of blindly applying whatever arrives last.
type opRequestPayload struct {
	Property  string          `json:"property"`
	Value     json.RawMessage `json:"value"`
	LamportTS int64           `json:"lamport_ts"`
	ClientID  string          `json:"client_id"`
}

// opResponsePayload mirrors ObjectsController#serialize_op: the op as Rails actually
// recorded it (in ObjectOp, not the object's current aggregate state). Rails is the
// source of truth for what gets broadcast — it may normalize a submitted value (e.g.
// resolving a color to its color_id) — and for a retried/duplicate op it echoes back that
// specific op's own value/lamport_ts/client_id, never whatever a different, newer op left
// the object's live state as.
type opResponsePayload struct {
	Value     json.RawMessage `json:"value"`
	LamportTS int64           `json:"lamportTs"`
	ClientID  string          `json:"clientId"`
}

func (s *RailsStore) SaveConfirmedOp(ctx context.Context, op Op) (Op, error) {
	switch op.Property {
	case "geometry", "color", "deleted_at", "text_crdt":
	default:
		return Op{}, fmt.Errorf("%w: %q", ErrUnsupportedOpProperty, op.Property)
	}

	body, err := json.Marshal(opRequestPayload{
		Property:  op.Property,
		Value:     op.Value,
		LamportTS: op.LamportTS,
		ClientID:  op.ClientID,
	})
	if err != nil {
		return Op{}, fmt.Errorf("encode op payload: %w", err)
	}

	endpoint := fmt.Sprintf("%s/boards/%s/objects/%s/ops", s.BackendURL, op.BoardID, op.ObjectID)
	token, _ := ctx.Value(tokenKey).(string)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Op{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Cookie", railsSessionCookieName+"="+token)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return Op{}, fmt.Errorf("failed to save op to rails: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
	case http.StatusConflict:
		var errPayload struct {
			Error            string `json:"error"`
			RestoreSuggested bool   `json:"restoreSuggested"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&errPayload); err == nil {
			if errPayload.RestoreSuggested {
				return Op{}, ErrDeletedObjectEdit
			}
		}
		return Op{}, ErrStaleOp
	default:
		return Op{}, fmt.Errorf("rails save op failed with status %d", resp.StatusCode)
	}

	var persisted opResponsePayload
	if err := json.NewDecoder(resp.Body).Decode(&persisted); err != nil {
		return Op{}, fmt.Errorf("decode rails op response: %w", err)
	}
	if len(persisted.Value) == 0 {
		return Op{}, fmt.Errorf("rails response missing persisted op value")
	}

	confirmed := op
	confirmed.Value = persisted.Value
	confirmed.LamportTS = persisted.LamportTS
	confirmed.ClientID = persisted.ClientID
	return confirmed, nil
}

type denyAllAuthenticator struct{}

func (denyAllAuthenticator) Authenticate(context.Context, string, string) (*AuthContext, error) {
	return nil, fmt.Errorf("no authenticator configured")
}

type denyAllAuthorizer struct{}

func (denyAllAuthorizer) Allow(context.Context, *AuthContext, Op) (bool, error) {
	return false, nil
}

type errorStore struct{}

func (errorStore) SaveConfirmedOp(context.Context, Op) (Op, error) {
	return Op{}, fmt.Errorf("no store configured")
}

type Handler struct {
	router        *sharding.Router
	upgrader      websocket.Upgrader
	originAllowed func(*http.Request) bool
	readLimit     int64
	hub           *Hub
	metrics       *Metrics
	authenticator Authenticator
	authorizer    Authorizer
	store         Store
	relay         Relay
	nodeID        string

	mu            sync.Mutex
	closing       bool
	closeCh       chan struct{}
	conns         sync.WaitGroup
	subscriptions map[string]context.CancelFunc
}

func NewHandler(router *sharding.Router, allowedOrigins []string) *Handler {
	metrics := NewMetrics()
	originChecker := newOriginChecker(allowedOrigins)
	return &Handler{
		router: router,
		upgrader: websocket.Upgrader{
			CheckOrigin: originChecker,
		},
		originAllowed: originChecker,
		readLimit:     MaxMessageSize,
		hub:           NewHub(metrics),
		metrics:       metrics,
		authenticator: denyAllAuthenticator{},
		authorizer:    denyAllAuthorizer{},
		store:         errorStore{},
		closeCh:       make(chan struct{}),
		subscriptions: make(map[string]context.CancelFunc),
		nodeID:        "sync-server-local",
	}
}

func (h *Handler) SetAuthenticator(authenticator Authenticator) {
	if authenticator != nil {
		h.authenticator = authenticator
	}
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

// MetricsHandler returns the Prometheus exposition-format HTTP handler for this
// Handler's metrics, suitable for mounting directly at a /metrics route.
func (h *Handler) MetricsHandler() http.Handler {
	return h.metrics.Handler()
}

func (h *Handler) ValidateConfigForProduction() error {
	if _, ok := h.authenticator.(denyAllAuthenticator); ok {
		return fmt.Errorf("authenticator is not configured for production")
	}
	if _, ok := h.authorizer.(denyAllAuthorizer); ok {
		return fmt.Errorf("authorizer is not configured for production")
	}
	if _, ok := h.store.(errorStore); ok {
		return fmt.Errorf("store is not configured for production")
	}
	return nil
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

	// Reject a disallowed Origin before doing anything else — in particular before the
	// authenticator makes any request to the Rails backend. Origin is only actually
	// enforced by websocket.Upgrader.CheckOrigin, which doesn't run until Upgrade() is
	// called, so without this early check every handshake attempt (regardless of Origin)
	// would trigger a Rails /session and /boards/:id request, letting an attacker amplify
	// disallowed-origin connection attempts into backend load.
	if !h.originAllowed(ctx.Request) {
		ctx.JSON(http.StatusForbidden, gin.H{
			"error": "origin not allowed",
		})
		return
	}

	boardID := ctx.Query("boardId")

	// Get token from Header (Authorization) or Cookie
	var token string
	if authHeader := ctx.GetHeader("Authorization"); strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		token = authHeader[7:]
	}
	if token == "" {
		if cookieToken, err := ctx.Cookie(railsSessionCookieName); err == nil {
			token = cookieToken
		}
	}

	target, err := h.router.Resolve(boardID)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	authCtx, err := h.authenticator.Authenticate(ctx.Request.Context(), boardID, token)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{
			"error": fmt.Sprintf("authentication failed: %v", err),
		})
		return
	}

	reqCtx := context.WithValue(ctx.Request.Context(), tokenKey, token)

	conn, err := h.upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		if !ctx.Writer.Written() {
			ctx.JSON(http.StatusBadRequest, gin.H{
				"error": "websocket upgrade failed",
			})
		}
		return
	}
	defer conn.Close()

	client := &client{
		send:    make(chan []byte, 32),
		done:    make(chan struct{}),
		closeCh: make(chan closeRequest, 1),
	}
	h.hub.Register(boardID, client)
	h.metrics.IncWebSocketConnections()

	writerDone := make(chan struct{})
	go h.writePump(conn, client, writerDone)

	defer func() {
		close(client.done)
		h.metrics.DecWebSocketConnections()
		h.hub.Unregister(boardID, client)
		h.cleanRelaySubscription(boardID)
		<-writerDone
	}()

	if err := h.ensureRelaySubscription(boardID); err != nil {
		client.requestClose(websocket.CloseInternalServerErr, err.Error())
		return
	}

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

	var lastPresenceBroadcast time.Time

	for {
		select {
		case <-h.closeCh:
			client.requestClose(websocket.CloseGoingAway, "server shutting down")
			return
		case <-writerDone:
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
				client.requestClose(websocket.CloseUnsupportedData, err.Error())
				return
			}

			if err := op.Validate(target.BoardID); err != nil {
				client.requestClose(websocket.ClosePolicyViolation, err.Error())
				return
			}

			allowed, err := h.authorizer.Allow(ctx.Request.Context(), authCtx, op)
			if err != nil {
				client.requestClose(websocket.CloseInternalServerErr, err.Error())
				return
			}
			if !allowed {
				client.requestClose(websocket.ClosePolicyViolation, "op rejected by permission check")
				return
			}

			if op.Property == "presence" {
				if err := validatePresenceValue(op.Value); err != nil {
					client.requestClose(websocket.ClosePolicyViolation, err.Error())
					return
				}

				now := time.Now()
				if !lastPresenceBroadcast.IsZero() && now.Sub(lastPresenceBroadcast) < PresenceBroadcastInterval {
					continue
				}

				lastPresenceBroadcast = now
				payload, err := op.MarshalJSON()
				if err != nil {
					client.requestClose(websocket.CloseInternalServerErr, err.Error())
					return
				}

				h.hub.Broadcast(boardID, payload)
				if h.relay != nil {
					if err := h.relay.Publish(ctx.Request.Context(), op); err != nil {
						client.requestClose(websocket.CloseInternalServerErr, err.Error())
						return
					}
				}
				continue
			}

			confirmedOp, err := h.store.SaveConfirmedOp(reqCtx, op)
			if err != nil {
				if errors.Is(err, ErrDeletedObjectEdit) {
					errPayload := DeletedObjectEditPayload{
						ObjectID:         op.ObjectID,
						Error:            "Object has been deleted; restore it before editing",
						RestoreSuggested: true,
					}
					if payload, jsonErr := json.Marshal(errPayload); jsonErr == nil {
						select {
						case client.send <- payload:
						default:
							client.requestClose(websocket.ClosePolicyViolation, "slow client, queue overflow")
							return
						}
					}
					continue
				}
				if errors.Is(err, ErrStaleOp) {
					// A newer op already won for this object; skip broadcasting this
					// one so other clients never see a value regress, but keep the
					// connection open since the client did nothing wrong.
					continue
				}
				if errors.Is(err, ErrUnsupportedOpProperty) {
					// Never broadcast an op the backend has no persistence path for —
					// clients would treat it as confirmed even though it vanishes on
					// reload. This is a protocol mismatch, not an internal failure.
					client.requestClose(websocket.CloseUnsupportedData, err.Error())
					return
				}
				client.requestClose(websocket.CloseInternalServerErr, err.Error())
				return
			}

			// Broadcast confirmedOp (what the store actually persisted), never the raw
			// op the client sent — the backend may normalize, coerce, or ignore parts of
			// the submitted value, and broadcasting the client's input would let other
			// clients drift from the confirmed backend state.
			payload, err := confirmedOp.MarshalJSON()
			if err != nil {
				client.requestClose(websocket.CloseInternalServerErr, err.Error())
				return
			}

			h.hub.Broadcast(boardID, payload)

			if h.relay != nil {
				if err := h.relay.Publish(ctx.Request.Context(), confirmedOp); err != nil {
					client.requestClose(websocket.CloseInternalServerErr, err.Error())
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
		case req, ok := <-client.closeCh:
			if ok {
				_ = writeClose(conn, req.code, req.text)
			}
			return
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

func (h *Handler) ensureRelaySubscription(boardID string) error {
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
			case <-subCtx.Done():
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

func (h *Handler) cleanRelaySubscription(boardID string) {
	if h.relay == nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if h.hub.RoomSize(boardID) == 0 {
		if cancel, ok := h.subscriptions[boardID]; ok {
			cancel()
			delete(h.subscriptions, boardID)
		}
	}
}

func writeClose(conn *websocket.Conn, code int, text string) error {
	_ = conn.SetWriteDeadline(time.Now().Add(WriteWait))
	message := websocket.FormatCloseMessage(code, text)
	return conn.WriteMessage(websocket.CloseMessage, message)
}

func validatePresenceValue(raw json.RawMessage) error {
	if len(raw) == 0 {
		return fmt.Errorf("presence value is required")
	}
	if len(raw) > MaxPresenceValueBytes {
		return fmt.Errorf("presence value must not exceed %d bytes", MaxPresenceValueBytes)
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fmt.Errorf("presence value must be an object: %w", err)
	}
	if len(payload) != 1 {
		return fmt.Errorf("presence value must contain only cursor")
	}

	cursorRaw, ok := payload["cursor"]
	if !ok {
		return fmt.Errorf("presence value must include cursor")
	}

	var cursor map[string]json.RawMessage
	if err := json.Unmarshal(cursorRaw, &cursor); err != nil {
		return fmt.Errorf("presence cursor must be an object: %w", err)
	}
	if len(cursor) != 2 {
		return fmt.Errorf("presence cursor must contain only x and y")
	}

	if _, ok := cursor["x"]; !ok {
		return fmt.Errorf("presence cursor must include x")
	}
	if _, ok := cursor["y"]; !ok {
		return fmt.Errorf("presence cursor must include y")
	}

	var x, y float64
	if err := json.Unmarshal(cursor["x"], &x); err != nil {
		return fmt.Errorf("presence cursor.x must be numeric: %w", err)
	}
	if err := json.Unmarshal(cursor["y"], &y); err != nil {
		return fmt.Errorf("presence cursor.y must be numeric: %w", err)
	}

	return nil
}

func newOriginChecker(allowedOrigins []string) func(*http.Request) bool {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[strings.ToLower(strings.TrimSpace(origin))] = struct{}{}
	}

	return func(request *http.Request) bool {
		origin := strings.ToLower(strings.TrimSpace(request.Header.Get("Origin")))
		if origin == "" {
			return false
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
