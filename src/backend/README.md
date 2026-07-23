# questboard backend

Rails API scaffold for questboard.

## Setup

1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL` for production Postgres
3. Set `CORS_ALLOWED_ORIGINS` for the frontend origin(s)
4. Set `ADMIN_BASIC_AUTH_USERNAME` and `ADMIN_BASIC_AUTH_PASSWORD`
5. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and `RECAPTCHA_SECRET_KEY`

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
| GET    | `/healthz` | Health check      | none        |
| GET    | `/admin`   | Admin dashboard   | HTTP Basic  |
| GET    | `/session` | Current session   | cookie      |
| DELETE | `/session` | Logout            | cookie      |
| POST   | `/auth/google_sessions` | Google login callback | none |
| POST   | `/boards` | Create a board | cookie |
| GET    | `/boards/:share_token` | Load board canvas state | cookie |
| POST   | `/boards/:share_token/join` | Join a board by share token | cookie |
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

## Lint & security

```sh
bundle exec rubocop
bundle exec brakeman
```

## Test

```sh
bundle exec rspec
```
