package server

import "github.com/gin-gonic/gin"

// securityHeaders は全応答にセキュリティヘッダを付ける。
//
// sync-server はヘッダを一つも返しておらず、フロント・backend との整合も
// 取れていなかった（issue #240）。WebSocket の待受が主用途とはいえ、
// /healthz と /metrics は通常の HTTP 応答であり、内容種別の推測防止や
// フレーム制限の対象になる。
//
// HSTS は production でのみ付ける。開発時の http://localhost に付けると、
// ブラウザがそのホストへの HTTPS を記憶してしまい、以後 localhost の
// 平文アクセスが自分の環境で壊れる。
func securityHeaders(env string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		header := ctx.Writer.Header()
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Referrer-Policy", "no-referrer")
		// このサーバーは HTML を返さないため、既定を全面的に塞いで問題ない
		header.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")

		if env == "production" {
			header.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}

		ctx.Next()
	}
}
