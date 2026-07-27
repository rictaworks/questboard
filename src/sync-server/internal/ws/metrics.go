package ws

import (
	"net/http"
	"time"

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
	syncOperationLatency prometheus.Histogram
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
	syncOperationLatency := prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "sync_server_sync_operation_duration_seconds",
		Help:    "Time spent processing a confirmed sync operation before it was broadcast or acknowledged.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5},
	})

	registry.MustRegister(websocketConnections, slowClientDrops, syncOperationLatency)

	return &Metrics{
		registry:             registry,
		websocketConnections: websocketConnections,
		slowClientDrops:      slowClientDrops,
		syncOperationLatency: syncOperationLatency,
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

func (m *Metrics) ObserveSyncOperationDuration(duration time.Duration) {
	m.syncOperationLatency.Observe(duration.Seconds())
}

// Handler returns the Prometheus exposition-format HTTP handler for this Metrics'
// registry, suitable for mounting directly at a /metrics route.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
