package server

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const bearerPrefix = "Bearer "

// metricsAuth guards /metrics with a shared bearer token.
//
// /metrics was registered without any middleware and sync-server is reachable from the
// public internet (the browser connects to it via NEXT_PUBLIC_SYNC_SERVER_URL), so the
// endpoint was readable by anyone (issue #229). /healthz stays unauthenticated because the
// external uptime monitor has to poll it.
//
// An empty token disables the check so development and the Go tests can scrape without
// configuring anything. Production must not reach that branch: server.New rejects a
// production config with no token, rather than silently serving metrics unauthenticated.
func metricsAuth(token string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if token == "" {
			ctx.Next()

			return
		}

		header := ctx.GetHeader("Authorization")
		if !strings.HasPrefix(header, bearerPrefix) {
			ctx.AbortWithStatus(http.StatusUnauthorized)

			return
		}

		provided := strings.TrimPrefix(header, bearerPrefix)
		// Constant-time compare: a byte-by-byte early exit would let a caller recover the
		// token one character at a time from response timing.
		if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			ctx.AbortWithStatus(http.StatusUnauthorized)

			return
		}

		ctx.Next()
	}
}
