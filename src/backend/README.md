# questboard backend

Rails API scaffold for questboard.

## Setup

1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL` for production Postgres
3. Set `CORS_ALLOWED_ORIGINS` for the frontend origin(s)
4. Set `ADMIN_BASIC_AUTH_USERNAME` and `ADMIN_BASIC_AUTH_PASSWORD`

## Endpoints

- `GET /healthz`
- `GET /admin`

## Test

```sh
bundle exec rspec
```
