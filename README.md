# Office Codex

Office Codex turns local Codex sessions into a live pixel-art office.

The project is split into three local pieces:

- `apps/cli`: the `office-codex` wrapper commands
- `apps/daemon`: the local observer and API server
- `apps/web`: the pixel office UI

The implementation targets macOS first, reads from `~/.codex`, and keeps chat content private by
exposing only session metadata and inferred activity states.

Recent UI additions:

- title hydration from Codex metadata with a local-only fallback derived from `threads.first_user_message`
- `Attention inbox` for blocked and errored sessions
- `Session drawer` with repo, branch, token usage, recent tools, and a short activity timeline
- account usage plumbing via `GET /api/account`, hidden in the UI unless a reliable source exists

## Stack

- Node.js 22.21+
- pnpm 10.28+
- TypeScript + Fastify + React + Canvas 2D
- Zustand for UI state
- Playwright + Vitest for verification

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the daemon and the Vite app in development:

```bash
pnpm dev
```

This starts:

- the daemon on `http://127.0.0.1:3210`
- the web UI on `http://127.0.0.1:5173`

Build everything:

```bash
pnpm build
```

Run the built dashboard from a single port:

```bash
pnpm start
```

The production-style app is then served on `http://127.0.0.1:3210`.

## CLI

Diagnose the local Codex sources:

```bash
pnpm office:doctor
```

Start the daemon explicitly:

```bash
pnpm office:dashboard
```

Launch Codex through the wrapper:

```bash
node --import tsx apps/cli/src/index.ts run -- --full-auto
```

Launch a safe live demo session you can watch in the dashboard:

```bash
pnpm office:demo-live
```

Customize the demo duration:

```bash
pnpm office:demo-live -- --seconds 45
```

Show command help:

```bash
pnpm office:demo-live -- --help
node --import tsx apps/cli/src/index.ts help demo-live
```

Typical manual test flow:

1. Start the dashboard with `pnpm dev` or `pnpm office:dashboard`.
2. Open the UI at `http://127.0.0.1:5173` in dev or `http://127.0.0.1:3210` in single-port mode.
3. Run `pnpm office:demo-live`.
4. Watch the roster and canvas show the session as live, then return to `waiting` or `offline`.

## Commands

- `office-codex --help`: show top-level CLI usage
- `office-codex dashboard --help`: explain the daemon command
- `office-codex run --help`: explain the wrapper command
- `office-codex doctor --help`: explain diagnostics
- `office-codex demo-live --help`: explain the live demo command

## Architecture

- `apps/cli`: wrapper commands for `dashboard`, `run`, `doctor`, and `demo-live`
- `apps/daemon`: watches `~/.codex`, infers agent state, exposes local API/SSE
- `apps/web`: React dashboard that renders the office on a single `<canvas>`
- `packages/core`: shared types, JSONL parsing, state inference
- `packages/assets`: fixed layout, palette, and project-owned pixel primitives

## Local API

- `GET /api/health`: daemon health and connection status
- `GET /api/layout`: fixed office layout used by the canvas
- `GET /api/sessions`: current session snapshot, including `tokensUsed` when available
- `GET /api/events`: live session events over SSE
- `GET /api/account`: account usage status

`/api/account` only surfaces a quota pill when the daemon can verify a reliable local source. If
that source is missing or incomplete, the UI stays silent instead of guessing.

## Title Hydration

Session titles use this precedence:

1. `threads.title` when it looks human
2. `session_index.thread_name` when it looks human
3. a short local-only title derived from `threads.first_user_message`
4. UI fallback based on repo, branch, and desk identity

You can disable prompt-derived hydration with:

```bash
OFFICE_CODEX_TITLE_HYDRATION_MODE=metadata pnpm office:dashboard
```

## Privacy

Office Codex does not expose prompt or response bodies through the dashboard API. The daemon only
emits session metadata, timestamps, current tool names, and inferred activity states.

## Notes

- The daemon prefers `better-sqlite3` for reading the Codex threads database and falls back to the
  system `sqlite3` binary when native bindings are unavailable.
- The repository includes a mocked `tests/fixtures/codex-home` so smoke tests can run without your
  personal `~/.codex`.
