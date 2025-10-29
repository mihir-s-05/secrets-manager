# Secrets Manager CLI (Ink)

Interactive CLI for managing secrets, directory membership, and admin tasks against the Secrets Manager backend described in `frontend.md`/`project.md`.

## Prerequisites

- Node.js 20+
- Backend service available (defaults to `http://localhost:4000`)

## Install & Run

```bash
npm install
npm run dev   # live reload during development
# or build & run
npm run build
npm start
```

The CLI persists session data using `conf` under the `secrets-cli` namespace.

## Primary Keybindings

- `Tab / Shift+Tab` – cycle focus
- `?` – toggle global help
- `g` – command palette
- `Ctrl+S` or `s` – save secret when editing
- `Esc` – close dialogs or navigate back
- `q` – quit (prompts when editing)

Screen-specific bindings are shown in the footer Key Legend (e.g., `n` to create a secret, `t` to create a team, `l` to logout from Settings).

## Tests

```bash
npm test
```

Vitest exercises the Home, SecretsList, and SecretEdit screens with mocked fetches and key interactions.

## Notable Commands

- `npm run build` – type-check and emit `dist/index.js`
- `npm start` – run the built CLI (`dist/index.js` must exist)
- `npm run dev` – hot reload entrypoint via `tsx`
