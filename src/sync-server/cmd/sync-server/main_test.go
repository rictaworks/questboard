package main

import (
	"testing"

	"github.com/rictaworks/questboard/src/sync-server/internal/ws"
)

// 開発・本番を問わず Rails 連携の3点セットが配線されることを固定する。
// 非本番だけ no-op のストア・認証に差し替えると、WS 経由の op が永続化されず
// 削除がリロードで復活する・クエストが進まない不具合が再発する（issue #197）。
func TestRailsWiringReturnsRailsBackedComponents(t *testing.T) {
	backendURL := "http://backend.example:3001"
	authenticator, authorizer, store := railsWiring(backendURL)

	client, ok := authenticator.(*ws.RailsAPIClient)
	if !ok {
		t.Fatalf("authenticator = %T, want *ws.RailsAPIClient", authenticator)
	}
	if client.BackendURL != backendURL {
		t.Fatalf("authenticator BackendURL = %q, want %q", client.BackendURL, backendURL)
	}

	if _, ok := authorizer.(ws.RailsAuthorizer); !ok {
		t.Fatalf("authorizer = %T, want ws.RailsAuthorizer", authorizer)
	}

	railsStore, ok := store.(*ws.RailsStore)
	if !ok {
		t.Fatalf("store = %T, want *ws.RailsStore", store)
	}
	if railsStore.BackendURL != backendURL {
		t.Fatalf("store BackendURL = %q, want %q", railsStore.BackendURL, backendURL)
	}
}
