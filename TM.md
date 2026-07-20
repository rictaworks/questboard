# Threat Model

## Scope

Questboard is a Google OAuth web app with Rails APIs, Gin WebSocket sync, a BASIC-auth developer/admin area, and shared board URLs.
This document captures the main application-specific threats that matter for the current design.

## Trust boundaries

- Public browser client
- Google OAuth identity provider
- Rails API / session layer
- Gin WebSocket sync layer
- PostgreSQL data store
- BASIC-auth protected admin dashboard
- KPI/event pipeline

## Primary threats

| ID | Threat | Why it matters | Main defenses |
|---|---|---|---|
| T1 | Google OAuth account takeover / login CSRF | User identity is the primary auth boundary | Validate disposable `state` bound to session, verify `sub` (and OIDC `iss`/`aud`/`exp`/`signature`/`nonce` / PKCE), use secure session cookies |
| T2 | BASIC-auth admin compromise | Admin dashboard exposes operational and KPI data | Strong credentials, HTTPS only, lock down routes and headers |
| T3 | F7 authorization bypass | Board role checks gate edit/comment/view actions | Enforce F7 server-side for every Rails and WS action |
| T4 | F6 concurrent-edit race conditions | Conflicting ops can corrupt board state | Lamport/LWW rules, CRDT for text, deterministic tie-breaking |
| T5 | WebSocket op injection | A forged op could mutate other users’ objects | Authenticate sockets, validate board membership, schema-check ops |
| T6 | XSS in sticky/text/comment bodies | Rich user content is rendered back to clients | Escape on output, sanitize where needed, avoid raw HTML |
| T7 | CSRF on Rails endpoints | Session-based requests can be forged by another site | CSRF tokens, SameSite cookies, origin checks |
| T8 | KPI PII leakage | Analytics must not contain personal data | Reject PII fields before buffering or sending |
| T9 | Shared URL guessing | Board share tokens may expose private boards | High-entropy tokens, rotation, access checks on lookup |
| T10 | Admin/ops data exposure | Logs, dashboards, and metrics can reveal sensitive state | Minimize logged data, protect dashboards, audit access |

## App-specific notes

### F6 concurrent editing

- Object ops are accepted only through the sync pipeline.
- Same-timestamp conflicts must resolve deterministically.
- Deleted objects must not accept fresh edit ops.
- Presence data is transient and must not be persisted as user content.

### F7 permissions

- owner: all actions
- editor: edit actions except board deletion and role changes
- commenter: comment creation, own comment edits/deletes, read-only board access
- viewer: read-only only
- Locked frames restrict editing to the lock holder or owner

### Shared URLs / share tokens

- Board lookup by token must not be enumerable.
- Tokens need sufficient entropy and must be unguessable.
- Access checks still apply after token resolution.

### Content rendering

- Sticky text, text objects, and comment bodies are attacker-controlled input.
- Never trust client-side escaping alone.
- Render as text by default and only allow a safe subset if a rich-text path exists.

### KPI collection

- KPI events may include `userId=Google sub`, board context, and event properties.
- Reject names, emails, addresses, phone numbers, dates of birth, and other PII.
- Keep event payloads minimal and structured.

