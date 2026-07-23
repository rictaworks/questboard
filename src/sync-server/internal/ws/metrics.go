package ws

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics owns a dedicated Prometheus registry (rather than the global
// prometheus.DefaultRegisterer) so multiple Metrics instances — one per Handler, as tests
// construct — never collide by registering the same metric name twice.
type Metrics struct {
	registry             *prometheus.Registry
	websocketConnections prometheus.Gauge
	slowClientDrops      prometheus.Counter
}

func NewMetrics() *Metrics {
	registry := prometheus.NewRegistry()

	websocketConnections := prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "sync_server_websocket_connections",
		Help: "Current number of active WebSocket connections.",
	})
	slowClientDrops := prometheus.NewCounter(prometheus.CounterOpts{
		Name: "sync_server_slow_client_drops_total",
		Help: "Total number of clients disconnected for falling behind on broadcast delivery.",
	})

	registry.MustRegister(websocketConnections, slowClientDrops)

	return &Metrics{
		registry:             registry,
		websocketConnections: websocketConnections,
		slowClientDrops:      slowClientDrops,
	}
}

func (m *Metrics) IncWebSocketConnections() {
	m.websocketConnections.Inc()
}

func (m *Metrics) DecWebSocketConnections() {
	m.websocketConnections.Dec()
}

func (m *Metrics) IncSlowClientDrops() {
	m.slowClientDrops.Inc()
}

// Handler returns the Prometheus exposition-format HTTP handler for this Metrics'
// registry, suitable for mounting directly at a /metrics route.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
