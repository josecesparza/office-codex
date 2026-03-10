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
- account usage plumbing via `GET /api/account`, backed by Codex Desktop's `/wham/usage`

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
- `GET /api/events`: live session events plus `account_updated` over SSE
- `GET /api/account`: account usage status

`/api/account` reads the same `https://chatgpt.com/wham/usage` source Codex Desktop uses when a
valid ChatGPT auth token is present in `~/.codex/auth.json`. When that source is unavailable or the
token is expired, the UI shows a neutral `usage unavailable` badge instead of guessing.

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

You can override the remote usage source and refresh interval with:

```bash
OFFICE_CODEX_CHATGPT_ORIGIN=https://chatgpt.com
OFFICE_CODEX_ACCOUNT_REFRESH_MS=60000
```

## Roadmap

Office Codex should optimize for one job first: helping a programmer supervise multiple Codex
agents with low cognitive load. The roadmap below prioritizes attention management, state clarity,
and project coordination over visual customization.

### Immediate priorities

- **Session and state reliability**
  - make session-to-agent mapping more robust
  - improve status detection for real user-facing states such as `Thinking`, `Using tool`,
    `Waiting for you`, `Ready`, `Blocked`, `Cancelled`, and `Offline`
  - detect important transitions reliably: permission needed, cancel, rollback, turn completion,
    long-running tool calls, and real user input waits

- **Attention-first workflow**
  - evolve `Attention inbox` into the main operational surface for multi-agent supervision
  - prioritize sessions that need action now: waiting for input, permission needed, errors, stuck
    agents, and recently finished work
  - show human reasons instead of only labels, for example `Needs answer`, `Needs approval`, or
    `No progress in 4m`

- **Clearer state model for humans**
  - keep the primary state focused on the visible conversation, not on internal subtasks
  - show parallel work as a secondary signal instead of turning a finished parent session back into
    `Thinking`
  - reduce ambiguous or misleading states so the user can trust the board at a glance

### Next phase

- **Actionable top metrics and filters**
  - turn the health cards into filters so the user can click `Waiting`, `Blocked`, or `Using tools`
    and focus the office and roster immediately
  - separate `Live` from `Busy` so open sessions are not confused with sessions actively working

- **Recently changed and recent outcomes**
  - highlight sessions whose state changed since the user's last glance
  - add a `Recently finished` queue so completed work does not disappear into `Ready`
  - make it easy to answer the question: “what changed while I was looking elsewhere?”

- **Stuck detection and escalation**
  - detect long periods of `Thinking` or `Using tool` with no progress
  - promote those sessions into the inbox with a clear reason and duration
  - help users notice agents that silently stopped being productive

### Project coordination

- **Desks as projects or directories**
  - let desks represent a repo, directory, or worktree instead of being only visual slots
  - make it obvious which agents are working on the same codebase
  - support assigning sessions to desks/projects intentionally, not only automatically

- **Git worktree awareness**
  - surface when several agents are working on the same repo without isolation
  - highlight safer setups that use separate worktrees for parallel implementation
  - reduce collisions and confusion when many agents edit related code at once

- **Agent teams and parent-child relationships**
  - visualize coordination between a main agent and its subtasks or helper agents
  - show which sessions are independent and which belong to the same effort
  - keep those relationships readable without turning the office into noise

### Later

- **Agent definitions before launch**
  - define reusable agent profiles such as `Reviewer`, `Debugger`, `Implementer`, or `Researcher`
  - attach a role, name, project context, and expected workflow before starting the session
  - make the roster easier to scan when many similar agents are running

- **Useful notifications**
  - notify only for events that change what the user should do: waiting for input, approval needed,
    blocked, stuck, or finished
  - avoid noisy notifications for every minor state transition

## Privacy

Office Codex does not expose prompt or response bodies through the dashboard API. The daemon only
emits session metadata, timestamps, current tool names, and inferred activity states.

## Notes

- The daemon prefers `better-sqlite3` for reading the Codex threads database and falls back to the
  system `sqlite3` binary when native bindings are unavailable.
- The repository includes a mocked `tests/fixtures/codex-home` so smoke tests can run without your
  personal `~/.codex`.
