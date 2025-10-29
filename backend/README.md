# Secrets Manager Backend

This package provides the Fastify + Prisma backend for the Secrets Manager project. It implements OAuth device login with GitHub, JWT/refresh token management, organization-scoped directories, admin tooling, and per-secret ACLs with read/write splits, history, and exhaustive automated tests.

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

## API Examples (cURL)

The snippets below illustrate the end-to-end flow. Replace placeholder values (e.g. `DEVICE_CODE`, `TEAM_ID`) with the values returned by previous responses.

```bash
export API_BASE="http://localhost:4000"
export DEVICE_ID="cli-demo"
```

### 1. Start device login (mock)

```bash
curl -s -X POST "$API_BASE/auth/start" | jq
```

The response includes `deviceCode`, `userCode`, and `verificationUri`. Visit the verification URL, enter the user code, and approve the request while logged into GitHub.

Poll until the login completes (normally the CLI does this loop). On success you receive access/refresh tokens for the authenticated user:

```bash
curl -s -X POST "$API_BASE/auth/poll" \
  -H 'Content-Type: application/json' \
  -d "{\"deviceCode\":\"DEVICE_CODE\",\"deviceId\":\"$DEVICE_ID\"}" | jq
```

Capture the `accessToken` values for the admin and any additional users:

```bash
export ADMIN_TOKEN="access-token-from-login"
export MEMBER_TOKEN="member-access-token"
```

### 2. Create a team (admin token)

```bash
curl -s -X POST "$API_BASE/admin/teams" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"platform"}'
```

Store the returned `id` as `TEAM_ID`.

### 3. Create a user (admin token) and add to the team

```bash
NEW_USER_ID=$(curl -s -X POST "$API_BASE/admin/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev1@example.com","displayName":"Dev One"}' | jq -r '.id')

curl -s -X POST "$API_BASE/admin/teams/$TEAM_ID/members" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$NEW_USER_ID\"}"
```

Have the new user complete the device login flow to obtain their own `MEMBER_TOKEN`.

### 4. Create a secret with org/team/user ACLs

```bash
SECRET_ID=$(curl -s -X POST "$API_BASE/secrets" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"key\":\"STAGING_API_KEY\",
    \"value\":\"s3cr3t-value\",
    \"acls\":[
      {\"principal\":\"org\",\"canRead\":true,\"canWrite\":false},
      {\"principal\":\"team\",\"principalId\":\"$TEAM_ID\",\"canRead\":true,\"canWrite\":false},
      {\"principal\":\"user\",\"principalId\":\"$NEW_USER_ID\",\"canRead\":true,\"canWrite\":true}
    ]
  }" | jq -r '.id')
```

### 5. Read the secret list as another user

```bash
curl -s "$API_BASE/secrets" \
  -H "Authorization: Bearer $MEMBER_TOKEN" | jq
```

The response contains only secrets the user can read, along with `myPermissions` to indicate read/write access. To fetch the full secret (including value and ACLs), call:

```bash
curl -s "$API_BASE/secrets/$SECRET_ID" \
  -H "Authorization: Bearer $MEMBER_TOKEN" | jq
```

If the user loses write access, `PATCH /secrets/$SECRET_ID` will return `403` with `{ "error": { "code": "forbidden" } }`.

## Database & Seeding

The Prisma schema models organizations, users, teams, secrets, ACLs, history, and refresh tokens. The deterministic seed script ensures there is exactly one organization named **Acme** and an admin user (`Admin`) linked to it. Override the seeded admin email by setting `ADMIN_EMAIL` before running `npm run prisma:seed`.

## Testing

Vitest and Supertest drive the automated acceptance checks. The suite now covers:

- Health: `GET /health` returns `200` with `{ ok: true }`.
- Database: the seed script is idempotent and produces exactly one `Organization("Acme")` plus its admin user; Prisma CRUD operations succeed against SQLite.
- Auth device flow (mocked GitHub): start/poll/refresh/logout issue tokens, refresh sessions, and revoke on logout while enforcing consistent error payloads.
- Org & admin scoping: directory and admin routes honor the caller's organization and privilege level.
- Rate limiting: repeated `/auth/poll` requests hit the server-side limiter and emit the expected `Retry-After` header.
- Secrets ACLs: unit tests cover every ACL combination (none/org/user/team/union/cross-org/admin implicit on/off) and integration tests exercise org/team/user ACL enforcement, permissioned updates, history tracking, and the end-to-end sharing workflow.

Each Vitest file uses an isolated SQLite database (e.g. `auth-flow.test.db`, `database.test.db`) that is created and reset automatically during `beforeEach` hooks. After installing dependencies, run `npm test` (or `npx vitest run`) to execute the entire suite.

## Health Route

`GET /health` returns `{ ok: true, version }`, where `version` is pulled from `package.json`. This route is intended for uptime checks and automated acceptance tests.
