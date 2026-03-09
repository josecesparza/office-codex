import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOTSTRAP_SEED_LIMIT,
  DEFAULT_CURSOR_FLUSH_MS,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_IDLE_MS,
  DEFAULT_OFFLINE_HISTORY_CAP,
  DEFAULT_PORT,
  DEFAULT_TITLE_HYDRATION_MODE,
  DEFAULT_WRAPPER_HINT_TTL_MS,
} from "../src/config.js";
import { CursorStore } from "../src/cursor-store.js";
import { createServer } from "../src/server.js";
import { SessionStore } from "../src/session-store.js";
import { WrapperEventHandler } from "../src/wrapper-events.js";

async function createTestServer() {
  const root = await mkdtemp(join(tmpdir(), "office-codex-server-"));
  const store = new SessionStore({
    offlineHistoryCap: 5,
  });
  const cursorStore = new CursorStore(join(root, "cursors.json"), 500);
  const wrapperEvents = new WrapperEventHandler(store, 120_000);

  store.upsertSeed({
    cwd: "/workspace/live",
    sessionId: "live-session",
    source: "vscode",
    startedAt: "2026-03-09T18:00:00.000Z",
    title: "Live Session",
    updatedAt: "2026-03-09T18:00:00.000Z",
  });
  store.upsertSeed({
    cwd: "/workspace/offline-one",
    sessionId: "offline-1",
    source: "vscode",
    startedAt: "2026-03-09T17:58:00.000Z",
    title: "Offline One",
    updatedAt: "2026-03-09T17:58:00.000Z",
  });
  store.upsertSeed({
    cwd: "/workspace/offline-two",
    sessionId: "offline-2",
    source: "vscode",
    startedAt: "2026-03-09T17:59:00.000Z",
    title: "Offline Two",
    updatedAt: "2026-03-09T17:59:00.000Z",
  });
  store.markOffline("offline-1", "2026-03-09T17:58:00.000Z", {
    preserveUpdatedAt: true,
  });
  store.markOffline("offline-2", "2026-03-09T17:59:00.000Z", {
    preserveUpdatedAt: true,
  });

  const app = await createServer({
    adapter: {
      async close() {
        return undefined;
      },
      getMetrics() {
        return {
          bootstrapDurationMs: 25,
          bootstrappedSeeds: 3,
          bootstrappedTranscripts: 2,
          dbReader: "sqlite3" as const,
          ingestErrors: 0,
          lastIngestAt: "2026-03-09T18:00:00.000Z",
          parseErrors: 0,
          stateDbPath: "/tmp/state.sqlite",
          watchedRoots: ["/tmp/session_index.jsonl", "/tmp/sessions"],
        };
      },
    },
    codexHome: root,
    config: {
      bootstrapSeedLimit: DEFAULT_BOOTSTRAP_SEED_LIMIT,
      codexHome: root,
      cursorFlushMs: DEFAULT_CURSOR_FLUSH_MS,
      dataDir: join(root, "data"),
      idleMs: DEFAULT_IDLE_MS,
      offlineHistoryCap: DEFAULT_OFFLINE_HISTORY_CAP,
      port: DEFAULT_PORT,
      titleHydrationMode: DEFAULT_TITLE_HYDRATION_MODE,
      wrapperHintTtlMs: DEFAULT_WRAPPER_HINT_TTL_MS,
    },
    cursorStore,
    getAccountUsage: async () => ({
      remainingLabel: "Unlimited",
      source: "test",
      status: "available",
    }),
    logger: pino({ level: "silent" }),
    startedAt: Date.now() - 12_000,
    store,
    webDistDir: join(root, "missing-static"),
    wrapperEvents,
  });

  return {
    app,
    store,
  };
}

describe("createServer", () => {
  it("filters live and history sessions and reports metadata", async () => {
    const { app } = await createTestServer();

    const liveResponse = await app.inject({
      method: "GET",
      url: "/api/sessions?scope=live",
    });
    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/sessions?scope=history&limit=1",
    });
    const healthResponse = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(liveResponse.statusCode).toBe(200);
    expect(liveResponse.json().sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      "live-session",
    ]);
    expect(historyResponse.json().sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      "offline-2",
    ]);
    expect(historyResponse.json().meta.hasMoreHistory).toBe(true);
    expect(healthResponse.json().sessions).toMatchObject({
      live: 1,
      offline: 2,
      tracked: 3,
    });

    await app.close();
  });

  it("accepts internal wrapper events and updates the session store", async () => {
    const { app, store } = await createTestServer();

    const launchResponse = await app.inject({
      method: "POST",
      payload: {
        argv: ["exec", "demo"],
        cwd: "/workspace/new-session",
        pid: 4242,
        startedAt: "2026-03-09T19:00:00.000Z",
        type: "launch",
      },
      url: "/api/internal/wrapper-events",
    });
    const identifiedResponse = await app.inject({
      method: "POST",
      payload: {
        argv: ["exec", "demo"],
        cwd: "/workspace/new-session",
        pid: 4242,
        sessionId: "hinted-session",
        startedAt: "2026-03-09T19:00:00.000Z",
        type: "identified",
      },
      url: "/api/internal/wrapper-events",
    });
    const exitResponse = await app.inject({
      method: "POST",
      payload: {
        exitCode: 0,
        exitedAt: "2026-03-09T19:00:10.000Z",
        pid: 4242,
        sessionId: "hinted-session",
        type: "exit",
      },
      url: "/api/internal/wrapper-events",
    });

    expect(launchResponse.statusCode).toBe(202);
    expect(identifiedResponse.statusCode).toBe(202);
    expect(exitResponse.statusCode).toBe(202);
    expect(store.get("hinted-session")?.cwd).toBe("/workspace/new-session");
    expect(store.get("hinted-session")?.state).toBe("offline");

    const snapshotResponse = await app.inject({
      method: "GET",
      url: `/api/sessions?scope=history&limit=${DEFAULT_HISTORY_LIMIT}`,
    });

    expect(snapshotResponse.json().meta.offlineCount).toBeGreaterThanOrEqual(3);

    await app.close();
  });
});
