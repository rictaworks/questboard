# questboard backend

Rails API scaffold for questboard.

## Setup

1. Copy `.env.example` to `.env`
2. Start PostgreSQL with `docker compose up -d postgres` from the repository root
3. Set `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_TEST_DB`
4. Set `DATABASE_URL` for production Postgres
5. Set `CORS_ALLOWED_ORIGINS` for the frontend origin(s)
6. Set `ADMIN_BASIC_AUTH_USERNAME` and `ADMIN_BASIC_AUTH_PASSWORD`
7. Set `X_OAUTH_CLIENT_ID`, `X_OAUTH_REDIRECT_URI`, `RECAPTCHA_SECRET_KEY`, `X_FOLLOWER_GATE_TARGET_ACCOUNT_ID`, `X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN`, `X_FOLLOWER_CACHE_SYNC_INTERVAL_MINUTES`, and `X_FOLLOWER_CACHE_SYNC_PAGE_SIZE`

## Admin access

The `/admin` namespace is protected by HTTP Basic auth. There is no separate
login page — browsers prompt for the username/password configured via
`ADMIN_BASIC_AUTH_USERNAME` / `ADMIN_BASIC_AUTH_PASSWORD`. If either variable
is unset, the server responds with `401 Unauthorized` instead of granting
access.

## API endpoints

Full request/response specs live under [`SPEC/api`](../../SPEC/api) as the
API surface grows. Current endpoints:

| Method | Endpoint   | Title            | Auth        |
| ------ | ---------- | ---------------- | ----------- |
| GET    | `/healthz` | Health check (DB ping included; 503 when unhealthy) | none        |
| POST   | `/client_errors` | Client error intake log | none |
| GET    | `/admin`   | Admin dashboard   | HTTP Basic  |
| GET    | `/session` | Current session   | cookie      |
| DELETE | `/session` | Logout            | cookie      |
| POST   | `/auth/x_sessions` | X login callback | none |
| POST   | `/boards` | Create a board | cookie |
| GET    | `/boards/:share_token` | Load board canvas state | cookie |
| DELETE | `/boards/:share_token` | Delete a board | cookie |
| POST | `/boards/:share_token/join` | Join a board by share token | cookie |
| PATCH  | `/boards/:share_token/members/:user_id` | Update a board member role | cookie |
| POST   | `/boards/:share_token/objects` | Create an object (sticky/shape/text/connector/image/frame) | cookie |
| PATCH  | `/boards/:share_token/objects/:id/move` | Move an object | cookie |
| PATCH  | `/boards/:share_token/objects/:id/resize` | Resize an object | cookie |
| PATCH  | `/boards/:share_token/objects/:id/rotate` | Rotate an object | cookie |
| POST   | `/boards/:share_token/objects/:id/duplicate` | Duplicate an object | cookie |
| PATCH  | `/boards/:share_token/objects/:id/color` | Change an object's color | cookie |
| POST   | `/boards/:share_token/objects/:id/lock` | Lock an object | cookie |
| DELETE | `/boards/:share_token/objects/:id/lock` | Unlock an object | cookie |
| DELETE | `/boards/:share_token/objects/:id` | Tombstone-delete an object | cookie |

## Operational monitoring

- Poll `/healthz` from an external uptime monitor.
- Alert on 3 consecutive failures or any 5-minute outage.
- The sync-server exports Prometheus metrics at `/metrics` for WebSocket connection count and sync-operation latency.
- Follower cache maintenance runs as `bundle exec rails auth:sync_follower_cache` from a Railway scheduled job.
- Keep `X_FOLLOWER_CACHE_SYNC_INTERVAL_MINUTES` aligned with the Railway schedule and tune `X_FOLLOWER_CACHE_SYNC_PAGE_SIZE` to stay under X API limits.

## Lint & security

```sh
bundle exec rubocop
bundle exec brakeman
```

## Test

```sh
bundle exec rspec
```
