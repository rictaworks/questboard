package ws

import "sync/atomic"

type Metrics struct {
	websocketConnections atomic.Int64
}

func NewMetrics() *Metrics {
	return &Metrics{}
}

func (m *Metrics) IncWebSocketConnections() {
	m.websocketConnections.Add(1)
}

func (m *Metrics) DecWebSocketConnections() {
	m.websocketConnections.Add(-1)
}

func (m *Metrics) Snapshot() map[string]int64 {
	return map[string]int64{
		"websocket_connections": m.websocketConnections.Load(),
	}
}
