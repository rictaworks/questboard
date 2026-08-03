package ws_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

func TestRailsStoreForwardsRailsSessionCookieAndOpPayload(t *testing.T) {
	t.Parallel()

	var gotCookie string
	var gotPath string
	var gotBody map[string]any

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if cookie, err := r.Cookie("_questboard_session"); err == nil {
			gotCookie = cookie.Value
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"property":"geometry","value":{"x":10,"y":20},"lamportTs":7,"clientId":"client-a"}`))
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	ctx := ws.ContextWithToken(context.Background(), "encrypted-session-value")

	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "geometry",
		Value:     json.RawMessage(`{"x":10,"y":20}`),
		LamportTS: 7,
		ClientID:  "client-a",
	}

	if _, _, err := store.SaveConfirmedOp(ctx, op); err != nil {
		t.Fatalf("SaveConfirmedOp() error = %v, want nil", err)
	}

	if want := "/boards/board-1/objects/object-1/ops"; gotPath != want {
		t.Fatalf("request path = %q, want %q", gotPath, want)
	}

	if gotCookie != "encrypted-session-value" {
		t.Fatalf("Rails session cookie forwarded = %q, want %q", gotCookie, "encrypted-session-value")
	}

	if gotBody["property"] != "geometry" {
		t.Fatalf("body property = %v, want geometry", gotBody["property"])
	}
	if gotBody["lamport_ts"] != float64(7) {
		t.Fatalf("body lamport_ts = %v, want 7", gotBody["lamport_ts"])
	}
	if gotBody["client_id"] != "client-a" {
		t.Fatalf("body client_id = %v, want client-a", gotBody["client_id"])
	}
}

func TestRailsStoreReturnsPersistedOpNotClientSubmittedOp(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		clientValue     string
		clientLamportTS int64
		clientID        string
		railsBody       string
		wantValue       string
		wantLamportTS   int64
		wantClientID    string
	}{
		{
			// Rails may reject/reshape what it stores (e.g. only the fields that passed
			// validation); the persisted value is what must be broadcast, never whatever
			// shape the client happened to submit.
			name:            "uses rails-persisted value verbatim",
			clientValue:     `{"x":10,"rotation":0}`,
			clientLamportTS: 7,
			clientID:        "client-a",
			railsBody:       `{"property":"geometry","value":{"x":10,"rotation":0},"lamportTs":7,"clientId":"client-a"}`,
			wantValue:       `{"x":10,"rotation":0}`,
			wantLamportTS:   7,
			wantClientID:    "client-a",
		},
		{
			// A retried/duplicate op must echo back the specific ObjectOp record Rails
			// found for this (object, client_id, lamport_ts) — which can carry an older
			// lamport_ts/client_id/value than the object's current live state if a newer
			// op from a different client landed in between. SaveConfirmedOp must trust
			// Rails' response fields verbatim rather than assuming the caller's original
			// request lamport_ts/client_id are still authoritative.
			name:            "duplicate-op echo trusts rails' recorded lamport_ts/client_id",
			clientValue:     `{"x":10,"y":20}`,
			clientLamportTS: 5,
			clientID:        "client-a",
			railsBody:       `{"property":"geometry","value":{"x":10,"y":20},"lamportTs":5,"clientId":"client-a"}`,
			wantValue:       `{"x":10,"y":20}`,
			wantLamportTS:   5,
			wantClientID:    "client-a",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(tt.railsBody))
			}))
			t.Cleanup(backend.Close)

			store := ws.NewRailsStore(backend.URL)
			op := ws.Op{
				BoardID:   "board-1",
				ObjectID:  "object-1",
				Property:  "geometry",
				Value:     json.RawMessage(tt.clientValue),
				LamportTS: tt.clientLamportTS,
				ClientID:  tt.clientID,
			}

			persisted, _, err := store.SaveConfirmedOp(context.Background(), op)
			if err != nil {
				t.Fatalf("SaveConfirmedOp() error = %v, want nil", err)
			}

			var got, want any
			if err := json.Unmarshal(persisted.Value, &got); err != nil {
				t.Fatalf("unmarshal persisted value failed: %v (value = %s)", err, persisted.Value)
			}
			if err := json.Unmarshal([]byte(tt.wantValue), &want); err != nil {
				t.Fatalf("unmarshal want value failed: %v", err)
			}

			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(want)
			if string(gotJSON) != string(wantJSON) {
				t.Fatalf("persisted.Value = %s, want %s", gotJSON, wantJSON)
			}
			if persisted.LamportTS != tt.wantLamportTS {
				t.Fatalf("persisted.LamportTS = %d, want %d", persisted.LamportTS, tt.wantLamportTS)
			}
			if persisted.ClientID != tt.wantClientID {
				t.Fatalf("persisted.ClientID = %q, want %q", persisted.ClientID, tt.wantClientID)
			}
		})
	}
}

func TestRailsStoreTranslatesConflictIntoErrStaleOp(t *testing.T) {
	t.Parallel()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "geometry",
		Value:     json.RawMessage(`{"x":10}`),
		LamportTS: 1,
		ClientID:  "client-a",
	}

	_, _, err := store.SaveConfirmedOp(context.Background(), op)
	if !errors.Is(err, ws.ErrStaleOp) {
		t.Fatalf("SaveConfirmedOp() error = %v, want ErrStaleOp", err)
	}
}

func TestRailsStoreReturnsErrorForUnexpectedStatus(t *testing.T) {
	t.Parallel()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "color",
		Value:     json.RawMessage(`{"color_id":1}`),
		LamportTS: 1,
		ClientID:  "client-a",
	}

	_, _, err := store.SaveConfirmedOp(context.Background(), op)
	if err == nil {
		t.Fatal("SaveConfirmedOp() error = nil, want non-nil for a 500 response")
	}
	if errors.Is(err, ws.ErrStaleOp) {
		t.Fatal("SaveConfirmedOp() error wraps ErrStaleOp, want a plain error for a 500 response")
	}
}

func TestRailsStoreRejectsUnsupportedProperties(t *testing.T) {
	t.Parallel()

	called := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "presence",
		Value:     json.RawMessage(`{}`),
		LamportTS: 1,
		ClientID:  "client-a",
	}

	// Transient presence updates are never persisted through Rails.
	_, _, err := store.SaveConfirmedOp(context.Background(), op)
	if !errors.Is(err, ws.ErrUnsupportedOpProperty) {
		t.Fatalf("SaveConfirmedOp() error = %v, want ErrUnsupportedOpProperty", err)
	}

	if called {
		t.Fatal("backend was called for a transient property, want it to be rejected locally")
	}
}

func TestRailsStoreAcceptsTextCRDTOps(t *testing.T) {
	t.Parallel()

	var gotBody map[string]any
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"property":"text_crdt","value":{"ops":[{"insert":"hi"}]},"lamportTs":3,"clientId":"client-a"}`))
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "text_crdt",
		Value:     json.RawMessage(`{"ops":[{"insert":"hi"}]}`),
		LamportTS: 3,
		ClientID:  "client-a",
	}

	persisted, duplicate, err := store.SaveConfirmedOp(context.Background(), op)
	if err != nil {
		t.Fatalf("SaveConfirmedOp() error = %v, want nil", err)
	}
	if duplicate {
		t.Fatal("SaveConfirmedOp() duplicate = true, want false for a freshly-recorded op")
	}

	if gotBody["property"] != "text_crdt" {
		t.Fatalf("body property = %v, want text_crdt", gotBody["property"])
	}
	if persisted.Property != "text_crdt" {
		t.Fatalf("persisted.Property = %q, want text_crdt", persisted.Property)
	}
	if string(persisted.Value) != `{"ops":[{"insert":"hi"}]}` {
		t.Fatalf("persisted.Value = %s, want text_crdt payload", persisted.Value)
	}
}

func TestRailsStoreTranslatesResyncRequiredConflictIntoErrResyncRequired(t *testing.T) {
	t.Parallel()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"error":"ref_revision is required once text_crdt history exists for this object","resyncRequired":true}`))
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "text_crdt",
		Value:     json.RawMessage(`{"ops":[{"insert":"hi"}]}`),
		LamportTS: 1,
		ClientID:  "client-a",
	}

	_, _, err := store.SaveConfirmedOp(context.Background(), op)
	if !errors.Is(err, ws.ErrResyncRequired) {
		t.Fatalf("SaveConfirmedOp() error = %v, want ErrResyncRequired", err)
	}
	if errors.Is(err, ws.ErrStaleOp) {
		t.Fatal("SaveConfirmedOp() error wraps ErrStaleOp, want it to be distinguished as ErrResyncRequired")
	}
}

func TestRailsStoreTranslatesConflictIntoErrDeletedObjectEdit(t *testing.T) {
	t.Parallel()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"error":"Object has been deleted; restore it before editing","restoreSuggested":true}`))
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "geometry",
		Value:     json.RawMessage(`{"x":10}`),
		LamportTS: 1,
		ClientID:  "client-a",
	}

	_, _, err := store.SaveConfirmedOp(context.Background(), op)
	if !errors.Is(err, ws.ErrDeletedObjectEdit) {
		t.Fatalf("SaveConfirmedOp() error = %v, want ErrDeletedObjectEdit", err)
	}
}

// railsSessionCookieValue mimics a Rails encrypted session cookie: standard (non-URL-safe)
// Base64 payloads joined by "--", so it contains "+", "/" and "=".
const railsSessionCookieValue = "aB+c/dE=--fG+h/iJ=--kL+m/nO="

// rackUnescape mimics Rack::Utils.parse_cookies_header's decoding of a cookie value
// (URI.decode_www_form_component), which turns "+" into a space. Go's url.QueryUnescape
// has the same semantics.
func rackUnescape(t *testing.T, value string) string {
	t.Helper()
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		t.Fatalf("url.QueryUnescape(%q) error = %v", value, err)
	}
	return decoded
}

func TestRailsStoreEncodesSessionCookieSoRackDecodesItUnchanged(t *testing.T) {
	t.Parallel()

	var gotRawCookie string

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie("_questboard_session"); err == nil {
			gotRawCookie = cookie.Value
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"property":"geometry","value":{"x":10},"lamportTs":1,"clientId":"client-a"}`))
	}))
	t.Cleanup(backend.Close)

	store := ws.NewRailsStore(backend.URL)
	ctx := ws.ContextWithToken(context.Background(), railsSessionCookieValue)

	op := ws.Op{
		BoardID:   "board-1",
		ObjectID:  "object-1",
		Property:  "geometry",
		Value:     json.RawMessage(`{"x":10}`),
		LamportTS: 1,
		ClientID:  "client-a",
	}

	if _, _, err := store.SaveConfirmedOp(ctx, op); err != nil {
		t.Fatalf("SaveConfirmedOp() error = %v, want nil", err)
	}

	if gotRawCookie == railsSessionCookieValue {
		t.Fatalf("cookie was sent verbatim (%q); Rack would decode %q into %q and Rails would reject the session",
			gotRawCookie, gotRawCookie, rackUnescape(t, gotRawCookie))
	}

	if got := rackUnescape(t, gotRawCookie); got != railsSessionCookieValue {
		t.Fatalf("cookie after Rack-style decode = %q, want %q", got, railsSessionCookieValue)
	}
}

func TestRailsAPIClientEncodesSessionCookieSoRackDecodesItUnchanged(t *testing.T) {
	t.Parallel()

	gotRawCookies := map[string]string{}

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cookie, err := r.Cookie("_questboard_session"); err == nil {
			gotRawCookies[r.URL.Path] = cookie.Value
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		switch r.URL.Path {
		case "/session":
			_, _ = w.Write([]byte(`{"authenticated":true,"user":{"id":1,"displayName":"Tester"}}`))
		default:
			_, _ = w.Write([]byte(`{"membership":{"userId":1,"role":{"code":"owner"}}}`))
		}
	}))
	t.Cleanup(backend.Close)

	client := ws.NewRailsAPIClient(backend.URL)
	if _, err := client.Authenticate(context.Background(), "board-1", railsSessionCookieValue); err != nil {
		t.Fatalf("Authenticate() error = %v, want nil", err)
	}

	for _, path := range []string{"/session", "/boards/board-1"} {
		raw, ok := gotRawCookies[path]
		if !ok {
			t.Fatalf("no session cookie forwarded to %s", path)
		}
		if got := rackUnescape(t, raw); got != railsSessionCookieValue {
			t.Fatalf("%s: cookie after Rack-style decode = %q, want %q", path, got, railsSessionCookieValue)
		}
	}
}
