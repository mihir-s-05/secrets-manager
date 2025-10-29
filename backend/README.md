# Secrets Manager Backend Skeleton

This package provides the initial Fastify + Prisma backend needed for the secrets manager project. It includes strict environment validation, the full relational schema, deterministic seeding, a health check, and a working Vitest/Supertest harness.

## Quickstart

```bash
# install dependencies
npm install

# run database migrations (creates SQLite db at prisma/dev.db)
npm run prisma:migrate

# seed Acme org and admin user
npm run prisma:seed

# start the dev server with automatic reload
npm run dev

# run the production build
npm run build
npm run start

# execute the smoke test suite
npm test
```

The dev server listens on the port defined by `PORT` (defaults to `4000`) and exposes `GET /health`, which responds with:

```json
{ "ok": true, "version": "0.1.0" }
```

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed. All variables are validated on boot and failures produce descriptive errors.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | Port the Fastify server listens on. |
| `SERVER_URL` | `http://localhost:4000` | Base URL used for self-references. |
| `DATABASE_URL` | `file:./dev.db` | Prisma connection string (SQLite by default). |
| `JWT_SECRET` | `REPLACE_ME` | Secret for signing JWT access tokens. |
| `ACCESS_TOKEN_TTL_MIN` | `15` | Access token lifetime in minutes. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime in days. |
| `ADMIN_IMPLICIT_ACCESS` | `true` | Whether admins receive implicit secret access. |
| `ADMIN_EMAIL` | `admin@example.com` | Optional email for the seeded admin user. |
| `GITHUB_CLIENT_ID` | _(empty)_ | GitHub OAuth application client ID. |
| `GITHUB_CLIENT_SECRET` | _(empty)_ | GitHub OAuth application client secret. |

## GitHub Device Flow Setup

1. Create a new OAuth App at https://github.com/settings/developers.
2. Use `http://localhost:4000` for the Homepage URL.
3. Use `http://localhost:4000/auth/callback` for the Authorization callback URL (the backend validates the device flow and never hits this callback, but GitHub requires a value).
4. Copy the generated *Client ID* and *Client Secret* and store them in `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
5. Restart the backend so the new environment variables are picked up.

## Database & Seeding

The Prisma schema models organizations, users, teams, secrets, ACLs, history, and refresh tokens. The deterministic seed script ensures there is exactly one organization named **Acme** and an admin user (`Admin`) linked to it. Override the seeded admin email by setting `ADMIN_EMAIL` before running `npm run prisma:seed`.

## Testing

Vitest and Supertest provide the testing harness. The included smoke test boots the Fastify server on an ephemeral port and asserts that `GET /health` returns `200` and `{ ok: true }`. Run `npm test` to execute the suite.

## Health Route

`GET /health` returns `{ ok: true, version }`, where `version` is pulled from `package.json`. This route is intended for uptime checks and automated acceptance tests.
