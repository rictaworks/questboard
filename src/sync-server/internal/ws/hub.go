package ws

import "sync"

type client struct {
	send chan []byte
	done chan struct{}
}

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]map[*client]struct{}
}

func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]map[*client]struct{}),
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

func (h *Hub) Broadcast(boardID string, payload []byte) {
	h.mu.RLock()
	room := h.rooms[boardID]
	recipients := make([]*client, 0, len(room))
	for c := range room {
		recipients = append(recipients, c)
	}
	h.mu.RUnlock()

	for _, recipient := range recipients {
		recipient.send <- cloneBytes(payload)
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
