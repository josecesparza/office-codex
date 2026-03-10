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
      identityConfidence: "medium",
      state: "inactive",
      stateSource: "wrapper",
    });

    store.upsertSeed({
      cwd: "/workspace/demo-real",
      gitBranch: "main",
      rolloutPath: "/tmp/real-session.jsonl",
      sessionId: "019cd46b-7904-71a2-a937-d8ad8d389000",
      source: "vscode",
      startedAt: "2026-03-09T19:00:00.000Z",
      title: "Hydrated real session",
      updatedAt: "2026-03-09T19:00:05.000Z",
    });

    expect(store.get("019cd46b-7904-71a2-a937-d8ad8d389000")).toMatchObject({
      cwd: "/workspace/demo-real",
      gitBranch: "main",
      identityConfidence: "high",
      source: "vscode",
      stateSource: "wrapper",
      title: "Hydrated real session",
    });
  });

  it("merges a later wrapper identification into an already known transcript session", () => {
    const store = new SessionStore();
    const handler = new WrapperEventHandler(store, 120_000);
    const sessionId = "019cd46b-7904-71a2-a937-d8ad8d389002";

    store.upsertSeed({
      cwd: "/workspace/demo",
      rolloutPath: "/tmp/demo.jsonl",
      sessionId,
      source: "vscode",
      startedAt: "2026-03-09T19:00:00.000Z",
      title: "Transcript session",
      updatedAt: "2026-03-09T19:00:05.000Z",
    });

    handler.apply({
      argv: ["exec", "demo"],
      cwd: "/workspace/demo",
      pid: 9876,
      sessionId,
      startedAt: "2026-03-09T19:00:00.000Z",
      type: "identified",
    });

    expect(store.list()).toHaveLength(1);
    expect(store.get(sessionId)).toMatchObject({
      cwd: "/workspace/demo",
      identityConfidence: "high",
      source: "vscode",
      title: "Transcript session",
    });
  });

  it("ignores wrapper exits that are older than newer transcript activity", () => {
    const store = new SessionStore();
    const handler = new WrapperEventHandler(store, 120_000);
    const sessionId = "019cd46b-7904-71a2-a937-d8ad8d389001";

    handler.apply({
      argv: ["exec", "demo"],
      cwd: "/workspace/demo",
      pid: 4321,
      sessionId,
      startedAt: "2026-03-09T19:00:00.000Z",
      type: "identified",
    });

    store.upsertSeed({
      cwd: "/workspace/demo-real",
      rolloutPath: "/tmp/demo.jsonl",
      sessionId,
      source: "vscode",
      updatedAt: "2026-03-09T19:00:10.000Z",
    });

    handler.apply({
      exitCode: 0,
      exitedAt: "2026-03-09T19:00:05.000Z",
      pid: 4321,
      sessionId,
      type: "exit",
    });

    expect(store.get(sessionId)?.state).toBe("inactive");
    expect(store.get(sessionId)?.offlineReason).toBeNull();
  });
});
