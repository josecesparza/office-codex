# Office Codex

Office Codex turns local Codex sessions into a live pixel-art office.

The project is split into three local pieces:

- `apps/cli`: the `office-codex` wrapper commands
- `apps/daemon`: the local observer and API server
- `apps/web`: the pixel office UI

The implementation targets macOS first, reads from `~/.codex`, and keeps chat content private by
exposing only session metadata and inferred activity states.

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

## Architecture

- `apps/cli`: wrapper commands for `dashboard`, `run`, and `doctor`
- `apps/daemon`: watches `~/.codex`, infers agent state, exposes local API/SSE
- `apps/web`: React dashboard that renders the office on a single `<canvas>`
- `packages/core`: shared types, JSONL parsing, state inference
- `packages/assets`: fixed layout, palette, and project-owned pixel primitives

## Privacy

Office Codex does not expose prompt or response bodies through the dashboard API. The daemon only
emits session metadata, timestamps, current tool names, and inferred activity states.

## Notes

- The daemon prefers `better-sqlite3` for reading the Codex threads database and falls back to the
  system `sqlite3` binary when native bindings are unavailable.
- The repository includes a mocked `tests/fixtures/codex-home` so smoke tests can run without your
  personal `~/.codex`.
