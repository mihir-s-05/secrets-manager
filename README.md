# Secrets Manager

Fastify/Prisma backend + Ink CLI. Supports GitHub Device Flow auth, short‑lived JWT access tokens with refresh, org‑scoped directory and admin APIs, and per‑secret ACLs for org/user/team with read/write splits.

## Project layout

```
.
├── backend/        # Fastify API + Prisma ORM
├── my-ink-cli/     # Ink CLI front-end
├── full_plan.md    # Original implementation requirements
└── project.md      # High-level goals
```

## Prerequisites

- Node.js 20+
- npm 10+ (or pnpm 9+)
- SQLite 3 (bundled with Prisma's engines; no system binary is strictly required, but installing `sqlite3` helps with debugging)
- GitHub OAuth application for device flow (steps below)

## Backend setup

1. Install dependencies:

    ```bash
    npm install
    ```

2. Copy the example environment file and set values:

    ```bash
    cp backend/.env.example backend/.env
    ```

   | Variable | Default | Notes |
   | --- | --- | --- |
   | `PORT` | `4000` | HTTP port. |
   | `SERVER_URL` | `http://localhost:4000` | Used in device flow links. |
   | `DATABASE_URL` | `file:./dev.db` | SQLite connection string. |
   | `JWT_SECRET` | `REPLACE_ME` | HS256 signing key for access tokens. |
   | `ACCESS_TOKEN_TTL_MIN` | `15` | Access token lifetime in minutes. |
   | `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime in days. |
   | `ADMIN_IMPLICIT_ACCESS` | `true` | If `true`, admins automatically gain read/write on every secret. |
   | `ADMIN_EMAILS` | _(empty)_ | Comma‑separated emails that should be admins on login. |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | _(empty)_ | Device flow credentials. |

3. Register a GitHub OAuth App:

   1. Go to **GitHub → Settings → Developer settings → OAuth Apps**.
   2. Create a new app with:
      - Homepage URL: `http://localhost:4000`
      - Authorization callback URL: `http://localhost:4000/auth/callback` (the backend never serves it, but GitHub requires a value).
   3. Copy the **Client ID** and **Client Secret** into `backend/.env`.

4. Initialize the database and seed the default org/admin:

    ```bash
    npm run prisma:migrate
    npm run prisma:seed
    ```

5. Start the API:

    ```bash
    npm run dev
    ```

   The server exposes:

   - `GET /health` → `{ ok: true, version: "<package version>" }`
   - `/auth/*` → Device flow login, refresh, logout
   - `/org/*` → Org directory (users/teams)
   - `/admin/*` → User & team management (admin token + org scoping)
   - `/secrets/*` → Secret CRUD, ACL management, and history

## CLI (Ink app) setup

1. Install and build the CLI once:

    ```bash
    cd my-ink-cli
    npm install
    npm run build
    ```

   The bundled binary lives at `my-ink-cli/dist/index.js`.

2. (Optional) Link for a global `secrets` command:

    ```bash
    npm link
    # now `my-ink-cli` binary name (package bin) is available globally as `my-ink-cli`
    ```

   Without linking, invoke it directly from the project:

    ```bash
    node my-ink-cli/dist/index.js --help
    ```

3. Run the CLI with dev hot‑reload while iterating:

    ```bash
    cd my-ink-cli
    npm run dev
    ```

4. At any time, show help inside the app with `?`.

## Device flow login walkthrough

    ```
    secrets login            Authenticate with the device flow
    secrets logout           Revoke refresh token and clear local session
    secrets ls               Browse secrets you can read
    secrets get <key>        Show one secret's current value
    secrets set <key>        Create or edit a secret + ACLs
    secrets users            Directory of org users
    secrets teams            Directory of org teams
    secrets admin team add <name>
    secrets admin team add-user <teamId> <userId>
    secrets admin team rm-user <teamId> <userId>
    secrets admin user add <email> [--name <displayName>] [--admin]
    secrets admin user promote <userId>
    ```

4. Override the API target if the backend is not on `http://localhost:4000`:

    ```
    secrets --api https://example.com login
    ```

   You can also export `SECRETS_API`.

### Device flow login walkthrough

1. Run `secrets login`.
2. The CLI requests a device code (`POST /auth/start`), opens the verification URL, and shows the human code.
3. Approve the login in your browser (as the GitHub user).
4. The CLI polls `/auth/poll` until the backend exchanges the code for GitHub tokens, upserts a local user, issues access & refresh tokens, and returns your org profile.
5. On success the CLI persists the refresh token and device id using:
   - `keytar` (service `secretsmgr`, account `default`), **or**
   - A fallback file `~/.secretsmgr/session.json` with `0600` permissions.

> On Linux without a secrets daemon you'll see `org.freedesktop.secrets was not provided ...`; that's the CLI falling back to the file store. No action is required unless you want gnome-keyring/kwallet integration.

## Using the app

1) Start services

- Terminal A: `cd backend && npm run dev`
- Terminal B: `cd my-ink-cli && npm run dev` (or `npm run build && npm start`)

2) Log in

- The UI shows a login screen. Press `o` to open the verification URL, approve in the browser, and wait for the CLI to complete device flow. `c` shows the code again, `r` restarts.

3) Manage secrets

- From Home, open Secrets. Use j/k or arrows to navigate.
- Press Enter to view, or choose Create/Edit to modify a secret.
- In the editor:
  - Sections: `Ctrl+↑/↓` or `Tab/Shift+Tab` cycle Key → Value → ACL.
  - ACLs: `a` add (org/team/user), `d` delete, `←/→` switch Read/Write, `Space` toggles.
  - Save with `Ctrl+S`.
  - The value field is capped to avoid layout jumps; long values show an overflow indicator.

4) Directory (Users/Teams)

- `←/→` switches between Teams and Users.
- On Teams: `Tab` toggles focus between Teams and Members lists; `a` add member, `x` remove member (admin only).
- On Users: the right pane shows details for the highlighted user (name, email, role, teams).

5) Settings

- Edit the server URL and `Ctrl+S` to save.
- `r` reloads your profile from `/me` (useful after changing admin status).
- `l` logs out (revokes refresh token). `x` resets local app state.

## Admin in the UI

- Admin capabilities are available when your footer shows `(admin)`.
- Teams: create teams, add/remove members from the Teams tab.
- Users: invite users and toggle admin via the Directory/Users tab (where implemented).
- All actions are scoped to your org; cross‑org operations are rejected by the API.

## Session & persistence

State (API base URL, tokens, user) lives in the app’s config store. Access & refresh tokens + device id are persisted and auto‑refreshed. From Settings:

1. Press `l` to logout (server revokes the refresh token).
2. Press `x` to reset local app state.

## How it works (high level)

### Backend highlights

- **Fastify** receives all HTTP traffic and wires shared utilities (Prisma, auth decorators, error helpers).
- **Prisma ORM** wraps the SQLite schema defined in `backend/prisma/schema.prisma`.
- **Authentication**:
  - Device flow endpoints proxy GitHub's OAuth device endpoints and persist the GitHub profile.
  - Access tokens are signed JWTs (HS256) containing `orgId`, `isAdmin`, and `teamIds`.
  - Refresh tokens are random 48-byte secrets stored in `RefreshToken` rows with `deviceId`, `expiresAt`, and `revokedAt`.
- **ACL resolution** (`src/lib/perms.ts`):
  1. Reject users outside the secret's org.
  2. Grant implicit admin access if enabled.
  3. Union org, user, and team ACL entries; `resolvePermissions` returns `read`/`write` booleans.
- **Secrets API** accepts ACL payloads with a discriminated union on `principal` and returns list/detail responses including `myPermissions`.
- **Admin && directory routes** are always scoped to the caller's org.
- **Testing** via Vitest + Supertest:
  - Each suite provisions an isolated SQLite database (`file:./prisma/<name>.test.db`) via `prisma db push --force-reset --skip-generate`.
  - GitHub APIs are mocked with a queued `fetch` implementation.

### CLI highlights

- Built with Ink 5 + React 18 (Node 20). Dev via `tsx watch`.
- `src/api/client.ts` handles requests and auto‑refreshes access tokens on 401s.
- `src/types/dto.ts` defines Zod schemas used across screens and API wrappers.
- `src/state/session.ts` persists server URL, device id, tokens, and user in `conf`.
- UI uses small components (`List`, `MultiLineInput`, `Spinner`, `KeyLegend`) atop Ink primitives.

## Development scripts

```bash
cd backend && npm run dev                # start API with tsx watch
cd backend && npm run build              # compile to dist/
cd backend && npm run start              # run compiled output
cd backend && npm run test               # Vitest integration suite

cd my-ink-cli && npm run dev             # hot reload Ink app (tsx watch)
cd my-ink-cli && npm run build           # bundle to dist/
cd my-ink-cli && npm run start           # run compiled output
cd my-ink-cli && npm run test            # Vitest UI/service tests
```

## Running the full stack

1. Terminal A: `cd backend && npm run dev`.
2. Terminal B: `cd my-ink-cli && npm run dev` (or `npm run build && npm start`).
3. Log in, then explore secrets and directory/admin screens from the Ink UI.

Use the `--api` flag if the CLI runs from the repo root while the backend is elsewhere (e.g., staging).

## Testing

Backend:

```bash
cd backend && npm run test
```

CLI:

```bash
cd my-ink-cli && npm run test
```

> If Vitest prints a Prisma "Schema engine error" when targeting `file:/absolute/path`, check that the process can create the directory and that no stale WAL files are locked. Running the same `prisma db push --force-reset --skip-generate` manually with the failing `DATABASE_URL` helps confirm access.

## Troubleshooting

- **`org.freedesktop.secrets` warning**: Install a keyring daemon (e.g., `gnome-keyring`) or ignore the warning—the CLI automatically falls back to the encrypted session file.
- **Device flow stalls**: Ensure `GITHUB_CLIENT_ID`/`SECRET` are configured. Unauthorized results surface as `authorization_pending` with a `Retry-After` header; the CLI respects `Retry-After` and backs off.
- **JWT errors / 401s**: Confirm `JWT_SECRET` matches for builds; resetting the CLI session by deleting `~/.secretsmgr` can resolve mismatched tokens.
- **Prisma engine errors**: Verify you are using Node 20+, that the repo path contains no spaces requiring quoting on Linux, and that the process owns the target directory for SQLite databases.

### Admin role not applied after login

- Set `ADMIN_EMAILS` in `backend/.env` to a comma‑separated list of emails. The check is case‑insensitive and uses your primary verified GitHub email.
- Restart the backend so new env vars load.
- In the CLI, either logout/login or go to Settings and press `r` to reload your profile from `/me`.
- Confirm the footer shows `(admin)` after your `name@org` and that admin screens/actions are available. If not:
  - Hit `GET /me` and verify `isAdmin: true`.
  - Ensure your GitHub OAuth app has `user:email` scope enabled (we request `read:user user:email`).
  - Double‑check the exact email string in `ADMIN_EMAILS` matches the primary email GitHub returns.

### ACL save errors

- The backend expects ACL items with `principal: 'org'|'user'|'team'`.
- For `org`, omit `principalId` (server normalizes to `null`).
- The CLI maps its internal ACL entries to this shape automatically; upgrade/rebuild if you see a discriminator error.

## Keybindings and workflows (Ink UI)

### Global

- `?` Show/hide help
- `g` Command palette (jump to screens)
- `Tab` / `Shift+Tab` Move focus
- `Esc` Back/close overlays
- `q` / `Ctrl+C` Quit

Footer shows: `name@org (admin|member)  •  serverUrl  •  route • ? help`

### Login

- The login screen opens GitHub’s Device Flow. Use `o` to open the URL, `c` to print the code again, `r` to restart.

### Directory

- Tabs: `←/→` switch between Teams and Users.
- Focus: `Tab` toggles between Teams and Members lists on the Teams tab; Users tab focuses the list.
- Navigation: `j/k` or arrow keys move within the active list.
- Actions (admin): `r` refresh, `t` create team, `u` create user, `a` add member (on Teams tab), `x` remove member.
- The Users tab shows a details pane for the highlighted user (name, email, role, teams).

### Secrets editor

- Sections: `Ctrl+↑/↓` or `Tab/Shift+Tab` cycle sections (Key, Value, ACL).
- ACLs: `a` add, `d` delete, `Space` toggle permission on the highlighted row, `←/→` switch Read/Write column.
- Save: `Ctrl+S`.
- The value field is height‑capped to avoid layout jump while typing; an overflow indicator appears for long values.

### Settings

- Edit server URL, `Ctrl+S` to save.
- `l` logout (revokes refresh token), `x` reset app state, `r` reload profile from `/me` (useful after changing admin status server‑side).

## Security notes

- Secrets are stored as plaintext in SQLite for this exercise (per the project spec). If you need at-rest encryption, introduce AES-GCM with an org-specific key and wrap it with a server key.
- Refresh tokens are random 48-byte strings stored in the database; revocation updates `revokedAt`. Logging out via the CLI revokes tokens server-side.
- Device flow requires GitHub users to approve sign-ins explicitly; rate-limiting prevents aggressive polling.

---

With the backend running and the CLI built, a quick demo is:

```bash
cd backend && npm run dev
cd my-ink-cli && npm run dev   # or: npm run build && npm start
# In the Ink UI:
# 1) Login via GitHub
# 2) Create a secret and add ACLs
# 3) Browse Directory; add/remove team members (if admin)
# 4) Settings → r to reload profile
```

That covers the end-to-end device login, secret management, ACL enforcement, and admin provisioning workflows implemented in this repository.
