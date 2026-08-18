// Package originmatch builds the Codespaces-forwarded-origin pattern that the sync-server's
// WebSocket handler additionally accepts in development, mirroring the same problem already
// solved on the frontend (src/lib/backend-url.ts) and the Rails backend
// (src/backend/lib/development_allowed_origins.rb): a developer opening the frontend through
// its Codespaces forwarded URL sends an Origin header on that domain, not localhost, and the
// sync-server's own forwarded domain differs from the frontend's (each port gets its own
// subdomain), so neither the static SYNC_SERVER_ALLOWED_ORIGINS list nor the same-Host
// fallback in ws.newOriginChecker match it.
package originmatch

import (
	"fmt"
	"regexp"
)

// DevelopmentPattern returns a regexp matching any Codespaces-forwarded origin
// (https://<codespaceName>-<port>.<forwardingDomain>) under the given codespace, for any
// port. It returns nil (no additional pattern) when either input is blank — callers should
// only supply CODESPACE_NAME / CODESPACES_FORWARDING_DOMAIN in non-production environments;
// this function does not itself check the environment.
func DevelopmentPattern(codespaceName, forwardingDomain string) (*regexp.Regexp, error) {
	if codespaceName == "" || forwardingDomain == "" {
		return nil, nil
	}

	pattern := fmt.Sprintf(`^https://%s-\d+\.%s$`, regexp.QuoteMeta(codespaceName), regexp.QuoteMeta(forwardingDomain))

	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("originmatch: compiling development pattern: %w", err)
	}

	return compiled, nil
}
