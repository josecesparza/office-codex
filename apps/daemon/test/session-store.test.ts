import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseTranscriptLines } from "@office-codex/core";
import { describe, expect, it } from "vitest";

import { SessionStore } from "../src/session-store.js";

function fixture(name: string): string {
  return readFileSync(
    resolve(import.meta.dirname, "../../../packages/core/test/fixtures", name),
    "utf8",
  );
}

describe("SessionStore", () => {
  it("applies transcript entries and keeps the session accessible", () => {
    const store = new SessionStore();
    const entries = parseTranscriptLines(fixture("basic-session.jsonl"));

    for (const entry of entries) {
      store.applyEntry("session-basic", entry, {
        title: "Mock Dashboard Session",
        cwd: "/workspace/demo",
        source: "vscode",
        rolloutPath: "/tmp/basic-session.jsonl",
      });
    }

    const [session] = store.list();

    expect(session?.sessionId).toBe("session-basic");
    expect(session?.state).toBe("inactive");
    expect(session?.currentTool).toBeNull();
    expect(session?.identityConfidence).toBe("high");
  });

  it("marks stale sessions as offline", () => {
    const store = new SessionStore();
    store.upsertSeed({
      sessionId: "session-idle",
      title: "Idle session",
      cwd: "/workspace/demo",
      source: "vscode",
      rolloutPath: "/tmp/idle.jsonl",
      startedAt: "2026-03-09T18:00:00.000Z",
      updatedAt: "2026-03-09T18:00:00.000Z",
    });

    store.markStaleSessionsOffline(Date.parse("2026-03-09T18:05:00.000Z"), 60_000);

    expect(store.get("session-idle")?.state).toBe("offline");
    expect(store.get("session-idle")?.offlineReason).toBe("idle_timeout");
  });

  it("prefers hydrated human titles and keeps tokens used", () => {
    const store = new SessionStore();
    store.upsertSeed({
      sessionId: "session-hydrated",
      title: "019cd46b-7904-71a2-a937-d8ad8d389000",
      cwd: "/workspace/demo",
      source: "vscode",
      tokensUsed: 1200,
      updatedAt: "2026-03-09T18:00:00.000Z",
    });

    store.upsertSeed({
      sessionId: "session-hydrated",
      title: "Create dashboard for Codex sessions",
      tokensUsed: 4200,
      updatedAt: "2026-03-09T18:01:00.000Z",
    });

    const session = store.get("session-hydrated");

    expect(session?.title).toBe("Create dashboard for Codex sessions");
    expect(session?.tokensUsed).toBe(4200);
  });

  it("caps offline history while keeping live sessions", () => {
    const store = new SessionStore({
      offlineHistoryCap: 2,
    });

    for (const [index, sessionId] of ["live-1", "offline-1", "offline-2", "offline-3"].entries()) {
      store.upsertSeed({
        sessionId,
        title: sessionId,
        cwd: "/workspace/demo",
        source: "vscode",
        startedAt: `2026-03-09T18:0${index}:00.000Z`,
        updatedAt: `2026-03-09T18:0${index}:00.000Z`,
      });
    }

    store.markOffline("offline-1", "2026-03-09T18:01:00.000Z");
    store.markOffline("offline-2", "2026-03-09T18:02:00.000Z");
    store.markOffline("offline-3", "2026-03-09T18:03:00.000Z");

    expect(store.listLive().map((session) => session.sessionId)).toEqual(["live-1"]);
    expect(store.listOffline().map((session) => session.sessionId)).toEqual([
      "offline-3",
      "offline-2",
    ]);
    expect(store.get("offline-1")).toBeUndefined();
  });

  it("returns live and history views with pagination metadata", () => {
    const store = new SessionStore({
      offlineHistoryCap: 5,
    });

    store.upsertSeed({
      sessionId: "live-1",
      title: "Live 1",
      cwd: "/workspace/demo",
      source: "vscode",
      startedAt: "2026-03-09T18:00:00.000Z",
      updatedAt: "2026-03-09T18:00:00.000Z",
    });
    store.upsertSeed({
      sessionId: "offline-1",
      title: "Offline 1",
      cwd: "/workspace/demo",
      source: "vscode",
      startedAt: "2026-03-09T18:01:00.000Z",
      updatedAt: "2026-03-09T18:01:00.000Z",
    });
    store.upsertSeed({
      sessionId: "offline-2",
      title: "Offline 2",
      cwd: "/workspace/demo",
      source: "vscode",
      startedAt: "2026-03-09T18:02:00.000Z",
      updatedAt: "2026-03-09T18:02:00.000Z",
    });

    store.markOffline("offline-1", "2026-03-09T18:01:00.000Z", {
      preserveUpdatedAt: true,
    });
    store.markOffline("offline-2", "2026-03-09T18:02:00.000Z", {
      preserveUpdatedAt: true,
    });

    const allResult = store.query({
      limit: 1,
      scope: "all",
    });
    const historyResult = store.query({
      before: "2026-03-09T18:02:00.000Z",
      limit: 1,
      scope: "history",
    });

    expect(allResult.sessions.map((session) => session.sessionId)).toEqual(["live-1", "offline-2"]);
    expect(allResult.meta.hasMoreHistory).toBe(true);
    expect(allResult.meta.nextBefore).toBe("2026-03-09T18:02:00.000Z");
    expect(historyResult.sessions.map((session) => session.sessionId)).toEqual(["offline-1"]);
    expect(historyResult.meta.liveCount).toBe(1);
    expect(historyResult.meta.offlineCount).toBe(2);
  });

  it("does not let an older offline mark override newer transcript activity", () => {
    const store = new SessionStore();

    store.upsertSeed({
      sessionId: "session-fresh",
      title: "Fresh session",
      cwd: "/workspace/demo",
      source: "vscode",
      rolloutPath: "/tmp/fresh.jsonl",
      startedAt: "2026-03-09T18:00:00.000Z",
      updatedAt: "2026-03-09T18:05:00.000Z",
    });

    store.markOffline("session-fresh", "2026-03-09T18:04:00.000Z", {
      reason: "wrapper_exit",
    });

    expect(store.get("session-fresh")?.state).toBe("inactive");
    expect(store.get("session-fresh")?.offlineReason).toBeNull();
  });
});
