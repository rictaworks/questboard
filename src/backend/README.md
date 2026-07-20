# questboard backend

Rails API scaffold for questboard.

## Setup

1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL` for production Postgres
3. Set `CORS_ALLOWED_ORIGINS` for the frontend origin(s)
4. Set `ADMIN_BASIC_AUTH_USERNAME` and `ADMIN_BASIC_AUTH_PASSWORD`

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

## Lint & security

```sh
bundle exec rubocop
bundle exec brakeman
```

## Test

```sh
bundle exec rspec
```
