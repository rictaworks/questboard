# QA Checklist

This checklist maps OWASP Top 10 concerns to Questboard-specific checks.

## A01 Broken Access Control

- [ ] F7 is enforced on every board action in Rails and WebSocket sync
- [ ] owner/editor/commenter/viewer permissions match the design document
- [ ] locked-frame editing is limited to the lock holder or owner
- [ ] share-token access still requires membership or permitted board access

## A02 Cryptographic Failures

- [ ] Google OAuth flow requires disposable `state` bound to session (login CSRF prevention), verifies `sub` (plus OIDC `iss`/`aud`/`exp`/`signature`/`nonce` and PKCE if applicable), and uses secure session cookies
- [ ] BASIC-auth credentials are stored and transmitted securely
- [ ] shared board tokens are high-entropy and not guessable
- [ ] HTTPS is required for auth, session, and admin traffic

## A03 Injection

- [ ] object ops are schema-validated before persistence
- [ ] SQL/NoSQL injection: all DB access uses bound parameters / parameterized queries without string concatenation
- [ ] XSS prevention: user inputs (`object_ops.value`, `comments.body`, `objects.text_crdt`) are rendered as plain text by default, or sanitized with strict allowlist and URL scheme validation for rich text
- [ ] WebSocket payloads are rejected unless they match the allowed op schema

## A04 Insecure Design

- [ ] F6 conflict resolution is deterministic for concurrent edits
- [ ] deleted objects reject edit ops and surface the expected recovery path
- [ ] rate limits / validation exist for hot paths that can be spammed
- [ ] analytics and quest events cannot be used to infer hidden state

## A05 Security Misconfiguration

- [ ] BASIC-auth admin routes are isolated from public routes
- [ ] cookies use secure, HttpOnly, and SameSite settings
- [ ] CORS and WebSocket origin rules are explicit
- [ ] production debug / verbose error output is disabled

## A06 Vulnerable and Outdated Components

- [ ] Rails, Next, Gin, and runtime dependencies are tracked and updated
- [ ] dependency advisories are reviewed before release
- [ ] no deprecated auth or crypto libraries are introduced

## A07 Identification and Authentication Failures

- [ ] Google OAuth login is the only consumer login path
- [ ] reCAPTCHA is present where required by the design
- [ ] admin authentication is protected and brute-force resistant
- [ ] sessions expire and logout revokes access as expected

## A08 Software and Data Integrity Failures

- [ ] WebSocket op ingestion rejects tampered or out-of-order payloads
- [ ] synced board state is reconciled only through F6/F7 rules
- [ ] deploy and build artifacts are produced from trusted sources only
- [ ] KPI/event batching preserves integrity and cannot be client-forged

## A09 Security Logging and Monitoring Failures

- [ ] auth failures, permission denials, and sync errors are observable
- [ ] KPI events do not log PII while still supporting debugging
- [ ] health checks and alerting cover WebSocket and API availability
- [ ] admin access is auditable

## A10 Server-Side Request Forgery

- [ ] any future URL-fetching or preview feature validates allowed schemes and hosts
- [ ] current code paths do not blindly fetch attacker-controlled URLs
- [ ] outbound requests are restricted to known services when added

