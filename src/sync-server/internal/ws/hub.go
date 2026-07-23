package ws

import (
	"sync"

	"github.com/gorilla/websocket"
)

type closeRequest struct {
	code int
	text string
}

type client struct {
	send      chan []byte
	done      chan struct{}
	closeCh   chan closeRequest
	closeOnce sync.Once
}

func (c *client) requestClose(code int, text string) {
	c.closeOnce.Do(func() {
		c.closeCh <- closeRequest{code: code, text: text}
		close(c.closeCh)
	})
}

type Hub struct {
	mu      sync.RWMutex
	rooms   map[string]map[*client]struct{}
	metrics *Metrics
}

func NewHub(metrics *Metrics) *Hub {
	return &Hub{
		rooms:   make(map[string]map[*client]struct{}),
		metrics: metrics,
	}
}

func (h *Hub) Register(boardID string, c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[boardID]
	if room == nil {
		room = make(map[*client]struct{})
		h.rooms[boardID] = room
	}
	room[c] = struct{}{}
}

func (h *Hub) Unregister(boardID string, c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room := h.rooms[boardID]
	if room == nil {
		return
	}

	delete(room, c)
	if len(room) == 0 {
		delete(h.rooms, boardID)
	}
}

func (h *Hub) RoomSize(boardID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[boardID])
}

func (h *Hub) Broadcast(boardID string, payload []byte) {
	h.mu.RLock()
	room := h.rooms[boardID]
	recipients := make([]*client, 0, len(room))
	for c := range room {
		recipients = append(recipients, c)
	}
	h.mu.RUnlock()

	for _, recipient := range recipients {
		select {
		case recipient.send <- cloneBytes(payload):
		default:
			if h.metrics != nil {
				h.metrics.IncSlowClientDrops()
			}
			recipient.requestClose(websocket.ClosePolicyViolation, "slow client, queue overflow")
		}
	}
}

func (h *Hub) ConnectionCount() int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var total int64
	for _, room := range h.rooms {
		total += int64(len(room))
	}
	return total
}

func cloneBytes(payload []byte) []byte {
	if len(payload) == 0 {
		return nil
	}

	clone := make([]byte, len(payload))
	copy(clone, payload)
	return clone
}
