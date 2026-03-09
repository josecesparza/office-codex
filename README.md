# Office Codex

Office Codex turns local Codex sessions into a live pixel-art office.

The project is split into three local pieces:

- `apps/cli`: the `office-codex` wrapper commands
- `apps/daemon`: the local observer and API server
- `apps/web`: the pixel office UI

The implementation targets macOS first, reads from `~/.codex`, and keeps chat content private by
exposing only session metadata and inferred activity states.

## Status

This repository is being bootstrapped from scratch. The initial milestones are:

- workspace and tooling
- shared domain model and transcript parsing
- daemon adapters and API
- canvas-based dashboard
- tests, CI, and documentation
