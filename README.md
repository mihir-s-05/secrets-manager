# Secrets Manager

Fastify + Prisma backend and an Ink (React) terminal app for managing organization secrets with per‑secret ACLs and GitHub Device Flow authentication.

## Structure

```
.
├── backend/        # Fastify API + Prisma (SQLite)
└── my-ink-cli/     # Interactive Ink CLI (TUI)
```

## Requirements

- Node.js 20+
- npm 10+
- A GitHub OAuth App (for Device Flow — see below)

---

## Backend

The API is a Fastify server with Prisma (SQLite). It supports:

- GitHub Device Flow login (`/auth/start` → `/auth/poll`), refresh, logout
- Org‑scoped directory (`/org/users`, `/org/teams`)
- Admin actions (`/admin/*`) with org scoping
- Secrets with ACLs and history (`/secrets/*`)

Setup:

```bash
cd backend
npm install
cp .env.example .env

# Initialize the database and seed the Acme org + an admin
npm run prisma:migrate
npm run prisma:seed

# Run the API in dev mode
npm run dev
```

Environment variables (validated on boot):

| Name | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port. |
| `SERVER_URL` | `http://localhost:4000` | Base URL (e.g., for links). |
| `DATABASE_URL` | `file:./dev.db` | Prisma connection string (SQLite). |
| `JWT_SECRET` | `REPLACE_ME` | HS256 signing secret for access JWTs. |
| `ACCESS_TOKEN_TTL_MIN` | `15` | Access token lifetime (minutes). |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime (days). |
| `ADMIN_IMPLICIT_ACCESS` | `true` | If true, admins implicitly have RW access to all secrets. |
| `ADMIN_EMAIL` | `admin@example.com` | Seed script admin email. |
| `ADMIN_EMAILS` | _(empty)_ | Comma‑separated list; those emails are granted admin on login. |
| `GITHUB_CLIENT_ID` | _(empty)_ | GitHub OAuth App client ID. |
| `GITHUB_CLIENT_SECRET` | _(empty)_ | GitHub OAuth App client secret. |

GitHub OAuth App (Device Flow):

1. Create an OAuth App at GitHub → Settings → Developer settings → OAuth Apps.
2. Use any Homepage URL (e.g., `http://localhost:4000`).
3. Use any Authorization callback URL (required by GitHub, not used by this flow).
4. Put the Client ID/Secret into `.env` as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

Key endpoints:

- `GET /health` → `{ ok: true, version }`
- `POST /auth/start` → begin device flow (returns `deviceCode`, `userCode`, `verificationUri`, `pollIntervalSec`)
- `POST /auth/poll` → exchange `deviceCode` for `{ accessToken, refreshToken, user }` (429/428 for rate limiting/pending)
- `POST /auth/refresh` → refresh access JWT using `{ refreshToken, deviceId }`
- `POST /auth/logout` → revoke a refresh token
- `GET /me` → current user with org and teams
- `GET /org/users` and `GET /org/teams` → directory for your org
- `POST /admin/*` and related PATCH/DELETE → org‑scoped admin actions
- `GET /secrets` → list secrets you can read (includes `myPermissions`)
- `GET /secrets/:id` → secret detail (value included if readable) + ACLs
- `PATCH /secrets/:id` and `POST /secrets` → update/create secrets and ACLs
- `GET /secrets/:id/history` → version history

Testing:

```bash
cd backend
npm test
```

---

## Ink CLI (TUI)

An interactive terminal app built with Ink 5 and React 18. It talks to the backend and stores session data via `conf` (project name: `secrets-cli`).

Run it:

```bash
cd my-ink-cli
npm install

# During development (hot reload)
npm run dev

# Or build once and run
npm run build
npm start
```

Optional global link (creates a `my-ink-cli` command):

```bash
cd my-ink-cli
npm link
# now you can run: my-ink-cli
```

Default server URL is `http://localhost:4000`. Change it from the Settings screen; the CLI does not use a `--api` flag or env var for this.

Screens:

- Home: quick actions (Login/Logout, Secrets, Directory, Admin, Settings)
- Login: device flow (o = open URL, c = show code, r = restart)
- Secrets: browse and filter; Enter to view; n = new; e = edit; r = refresh; `/` to filter
- Secret view: toggle value visibility with `*`; e = edit; b = back
- Secret editor: Key (create only), Value, ACLs; Ctrl+S or s = save; a/d/Space/←/→ manage ACLs; Tab/Shift+Tab or Ctrl+↑/↓ switch sections
- Directory: tabs for Org/Teams/Users; create teams/users; manage memberships; view user details
- Admin: create users/teams, add/remove members, toggle admin, and “view as user”
- Settings: change server URL, logout, reset local state; admins also trigger server env reload on reset

Notes:

- Session store keeps `serverUrl`, a generated `deviceId`, tokens, and the current user. Access tokens auto‑refresh on 401 using the stored refresh token.
- Admin “view as user” sets a view‑as context; the CLI automatically adds `asUserId` to secrets endpoints so you see permissions exactly as that user.

Testing:

```bash
cd my-ink-cli
npm test
```

---

## Running the full stack

1. Terminal A: `backend` → `npm run dev`
2. Terminal B: `my-ink-cli` → `npm run dev` (or `npm run build && npm start`)
3. In the CLI, open Login, approve in your browser, then explore Secrets, Directory, Admin, and Settings.

Troubleshooting:

- If `/auth/start` returns a server error, ensure `GITHUB_CLIENT_ID` (and Secret for `/auth/poll`) are set.
- Prisma migrations require write access to the project directory for the SQLite file defined by `DATABASE_URL`.
- Access/permission errors include structured payloads: `{ error: { code, message } }`.

Security model highlights:

- Access JWTs embed `orgId`, `isAdmin`, and `teamIds` and are short‑lived; refresh tokens are bound to a `deviceId` and can be revoked.
- Secret ACLs can target the whole org, a team, or a user. Admin implicit access can be toggled with `ADMIN_IMPLICIT_ACCESS`.

