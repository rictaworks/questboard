package ws

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// writePump は client.closeCh と client.done が同時に ready になっても、
// 明示的なクローズ要求のコードを優先しなければならない。
//
// requestClose() は closeCh へ送ってから戻り、その直後に呼び出し元の defer が
// client.done を閉じる。writePump がまだ select に入っていなければ両方が同時に
// ready になり、Go の select はランダムにケースを選ぶ。優先しないと、サーバー
// 停止時の CloseGoingAway(1001) が CloseNormalClosure(1000) に化ける
// （internal/server の TestGracefulShutdownClosesWebSocketConnections が CI で
// 散発的に失敗していた原因）。
func TestWritePumpPrefersPendingCloseRequest(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	handler := NewHandler(nil, nil)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		c := &client{
			send:    make(chan []byte, 1),
			done:    make(chan struct{}),
			closeCh: make(chan closeRequest, 1),
		}

		// 実際の停止シーケンスと同じ順序で両方を ready にしてから writePump を開始する。
		c.requestClose(websocket.CloseGoingAway, "server shutting down")
		close(c.done)

		handler.writePump(conn, c, make(chan struct{}))
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// select のランダム性を捉えるため繰り返す。修正前は 1 回あたり約 1/2 で 1000 になる。
	for i := 0; i < 50; i++ {
		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			t.Fatalf("iteration %d: dial failed: %v", i, err)
		}

		if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			_ = conn.Close()
			t.Fatalf("iteration %d: SetReadDeadline() error = %v", i, err)
		}

		_, _, err = conn.ReadMessage()
		_ = conn.Close()

		var closeErr *websocket.CloseError
		if !errors.As(err, &closeErr) || closeErr.Code != websocket.CloseGoingAway {
			t.Fatalf("iteration %d: websocket read error = %v, want CloseError code %d (CloseGoingAway)",
				i, err, websocket.CloseGoingAway)
		}
	}
}
