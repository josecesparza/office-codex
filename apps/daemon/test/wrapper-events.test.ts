import { describe, expect, it } from "vitest";

import { SessionStore } from "../src/session-store.js";
import { WrapperEventHandler } from "../src/wrapper-events.js";

describe("WrapperEventHandler", () => {
  it("hydrates a hinted session before transcript ingestion and lets transcript data win later", () => {
    const store = new SessionStore();
    const handler = new WrapperEventHandler(store, 120_000);

    handler.apply({
      argv: ["exec", "demo"],
      cwd: "/workspace/demo",
      pid: 1234,
      sessionId: "019cd46b-7904-71a2-a937-d8ad8d389000",
      startedAt: "2026-03-09T19:00:00.000Z",
      type: "identified",
    });

    expect(store.get("019cd46b-7904-71a2-a937-d8ad8d389000")).toMatchObject({
      cwd: "/workspace/demo",
      state: "inactive",
    });

    store.upsertSeed({
      cwd: "/workspace/demo-real",
      gitBranch: "main",
      sessionId: "019cd46b-7904-71a2-a937-d8ad8d389000",
      source: "vscode",
      startedAt: "2026-03-09T19:00:00.000Z",
      title: "Hydrated real session",
      updatedAt: "2026-03-09T19:00:05.000Z",
    });

    expect(store.get("019cd46b-7904-71a2-a937-d8ad8d389000")).toMatchObject({
      cwd: "/workspace/demo-real",
      gitBranch: "main",
      source: "vscode",
      title: "Hydrated real session",
    });
  });
});
