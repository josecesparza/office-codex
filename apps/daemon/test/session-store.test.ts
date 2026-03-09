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
    expect(session?.state).toBe("waiting_user");
    expect(session?.currentTool).toBeNull();
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
  });
});
