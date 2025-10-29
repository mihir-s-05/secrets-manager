# Secrets Manager Monorepo

Full-stack secrets manager consisting of a Fastify/Prisma backend and an Ink-based CLI. The system supports GitHub OAuth device flow, short-lived JWT access tokens, refresh tokens persisted locally, and per-secret ACLs that combine org/user/team principals with read/write splits.

## Project layout

```
.
├── backend/        # Fastify API + Prisma ORM
├── cli/            # Ink CLI front-end
├── prisma/         # SQLite databases generated at runtime (per tests)
├── full_plan.md    # Original implementation requirements
└── project.md      # High-level goals
```

Both packages are published as Node workspaces and share the root `package-lock.json`. Commands below assume `npm`, but `pnpm` works with the equivalent `--filter` flags.

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
   | `ADMIN_EMAIL` | `admin@example.com` | Email assigned to the seeded admin user. |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | _(empty)_ | Device flow credentials. |

3. Register a GitHub OAuth App:

   1. Go to **GitHub → Settings → Developer settings → OAuth Apps**.
   2. Create a new app with:
      - Homepage URL: `http://localhost:4000`
      - Authorization callback URL: `http://localhost:4000/auth/callback` (the backend never serves it, but GitHub requires a value).
   3. Copy the **Client ID** and **Client Secret** into `backend/.env`.

4. Initialize the database and seed the default org/admin:

    ```bash
    npm run --workspace backend prisma:migrate
    npm run --workspace backend prisma:seed
    ```

5. Start the API:

    ```bash
    npm run --workspace backend dev
    ```

   The server exposes:

   - `GET /health` → `{ ok: true, version: "<package version>" }`
   - `/auth/*` → Device flow login, refresh, logout
   - `/org/*` → Org directory (users/teams)
   - `/admin/*` → User & team management (admin token + org scoping)
   - `/secrets/*` → Secret CRUD, ACL management, and history

## CLI setup

1. Build the CLI once:

    ```bash
    npm run --workspace cli build
    ```

   The bundled binary lives at `cli/dist/index.mjs`.

2. (Optional) Link for a global `secrets` command:

    ```bash
    npm run --workspace cli link
    # now `secrets --help` is available
    ```

   Without linking, invoke it directly:

    ```bash
    node cli/dist/index.mjs --help
    ```

3. Run `secrets --help` to confirm the command list:

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

### Using secrets & ACLs

- **List**: `secrets ls` shows only items you can read. `myPermissions` indicates `R`, `W`, or `RW`.
- **View**: `secrets get <key>` displays the current value plus metadata.
- **Create/update**: `secrets set <key>` launches the editor UI to modify the value and toggle org/team/user ACL lines. At least one writer is required; admins can implicitly write if `ADMIN_IMPLICIT_ACCESS=true`.
- **Share**: Use the `sharing` tab to grant read/write to org, specific users, or teams (lookups backed by `/org/users` & `/org/teams`).
- **Audit**: `GET /secrets/:id/history` (exposed via the API) lists past versions; the CLI surfaces history in the editor after an update.

### Admin flows

- `secrets admin team add <name>` → `POST /admin/teams`
- `secrets admin team add-user <teamId> <userId>` → `POST /admin/teams/:id/members`
- `secrets admin team rm-user <teamId> <userId>` → `DELETE /admin/teams/:id/members/:userId`
- `secrets admin user add <email>` [flags] → `POST /admin/users` (display name defaults to the email prefix)
- `secrets admin user promote <userId>` → `PATCH /admin/users/:id` with `isAdmin: true`

All admin commands require an access token with `isAdmin=true`. The backend enforces org scoping for every operation and rejects cross-org access with `404`.

### CLI persistence

State (API base URL, cached directories, toasts) lives in `~/.secretsmgr/config.json`. Access & refresh tokens + device id are loaded from keytar or the fallback file on startup. `secrets logout` will:

1. Call `POST /auth/logout` with the stored refresh token.
2. Delete the keytar entry or session file.

## How it works

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
- **Secrets API** maps ACL rows to friendly structures (`myPermissions` in list/detail responses) and accepts array-based ACL payloads.
- **Admin && directory routes** are always scoped to the caller's org.
- **Testing** via Vitest + Supertest:
  - Each suite provisions an isolated SQLite database (`file:./prisma/<name>.test.db`) via `prisma db push --force-reset --skip-generate`.
  - GitHub APIs are mocked with a queued `fetch` implementation.

### CLI highlights

- Built with Ink 6 + React 19, bundling through tsup.
- `services/api.ts` initialises an Axios client with request/response interceptors. On `401` it automatically calls `/auth/refresh` using the persisted refresh token, updates local state, and retries the request.
- `services/resources.ts` translates backend payloads (`myPermissions`, ACL rows, admin responses) into the CLI-friendly schemas.
- `services/auth.ts` handles device flow loop, session persistence (keytar/fallback), and logout.
- `services/store.ts` stores session state, directory caches, toast notifications, and screen reader flag via Zustand.
- UI components like `BoxedPanel`, `Toasts`, `Spinner`, and tables wrap Ink primitives for consistent layout.

## Development scripts

```bash
# backend
npm run --workspace backend dev          # start API with tsx watch
npm run --workspace backend build        # compile to dist/
npm run --workspace backend start        # run compiled output
npm run --workspace backend lint         # lint (requires eslint config)
npm run --workspace backend test         # Vitest integration suite

# CLI
npm run --workspace cli dev              # hot reload Ink app (tsx watch)
npm run --workspace cli build            # bundle to dist/
npm run --workspace cli test             # Vitest UI/service tests
npm run --workspace cli link             # npm link the secrets binary
```

## Running the full stack

1. In one terminal: `npm run --workspace backend dev`.
2. In another terminal: `npm run --workspace cli build && secrets login` (link first for convenience).
3. Once logged in, explore secrets and admin commands.

Use the `--api` flag if the CLI runs from the repo root while the backend is elsewhere (e.g., staging).

## Testing

Backend:

```bash
npm run --workspace backend test
```

CLI:

```bash
npm run --workspace cli test
```

> If Vitest prints a Prisma "Schema engine error" when targeting `file:/absolute/path`, check that the process can create the directory and that no stale WAL files are locked. Running the same `prisma db push --force-reset --skip-generate` manually with the failing `DATABASE_URL` helps confirm access.

## Troubleshooting

- **`org.freedesktop.secrets` warning**: Install a keyring daemon (e.g., `gnome-keyring`) or ignore the warning—the CLI automatically falls back to the encrypted session file.
- **Device flow stalls**: Ensure `GITHUB_CLIENT_ID`/`SECRET` are configured. Unauthorized results surface as `authorization_pending` with a `Retry-After` header; the CLI respects `Retry-After` and backs off.
- **JWT errors / 401s**: Confirm `JWT_SECRET` matches for builds; resetting the CLI session by deleting `~/.secretsmgr` can resolve mismatched tokens.
- **Prisma engine errors**: Verify you are using Node 20+, that the repo path contains no spaces requiring quoting on Linux, and that the process owns the target directory for SQLite databases.

## Security notes

- Secrets are stored as plaintext in SQLite for this exercise (per the project spec). If you need at-rest encryption, introduce AES-GCM with an org-specific key and wrap it with a server key.
- Refresh tokens are random 48-byte strings stored in the database; revocation updates `revokedAt`. Logging out via the CLI revokes tokens server-side.
- Device flow requires GitHub users to approve sign-ins explicitly; rate-limiting prevents aggressive polling.

---

With the backend running and the CLI linked, the shortest demo is:

```bash
secrets login
secrets ls
secrets set DEMO_KEY
secrets get DEMO_KEY
secrets admin user add teammate@example.com --name "Teammate"
secrets admin team add platform
secrets admin team add-user <teamId> <userId>
secrets logout
```

That covers the end-to-end device login, secret management, ACL enforcement, and admin provisioning workflows implemented in this repository.
