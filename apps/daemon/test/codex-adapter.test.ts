import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DaemonConfig, getCursorStorePath } from "../src/config.js";
import { CursorStore } from "../src/cursor-store.js";
import { SessionStore } from "../src/session-store.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../../../packages/core/test/fixtures");
const TEST_SESSION_ID = "019cd446-2822-73c2-8a07-39085846a816";

type WatchHandler = (filePath: string) => void | Promise<void>;

const handlers = new Map<string, WatchHandler>();
const close = vi.fn(async () => undefined);
const on = vi.fn((event: string, handler: WatchHandler) => {
  handlers.set(event, handler);
  return watcher;
});
const watcher = {
  close,
  on,
};
const watch = vi.fn(() => watcher);

vi.mock("chokidar", () => ({
  default: {
    watch,
  },
}));

async function createCodexHome(): Promise<DaemonConfig> {
  const root = await mkdtemp(join(tmpdir(), "office-codex-adapter-"));

  await mkdir(join(root, "sessions", "2026", "03", "09"), { recursive: true });

  return {
    bootstrapSeedLimit: 500,
    codexHome: root,
    cursorFlushMs: 500,
    dataDir: join(root, "data"),
    idleMs: 120_000,
    offlineHistoryCap: 200,
    port: 0,
    titleHydrationMode: "first_user_message",
    wrapperHintTtlMs: 120_000,
  };
}

async function transcriptFixture(): Promise<string> {
  const contents = await readFile(join(FIXTURES_DIR, "basic-session.jsonl"), "utf8");
  return contents.replace("session-basic", TEST_SESSION_ID);
}

describe("startPassiveCodexAdapter", () => {
  beforeEach(() => {
    handlers.clear();
    close.mockClear();
    on.mockClear();
    watch.mockClear();
  });

  it("watches the sessions root and ingests transcripts added after startup", async () => {
    const { startPassiveCodexAdapter } = await import("../src/codex-adapter.js");
    const config = await createCodexHome();
    const store = new SessionStore();
    const cursorStore = new CursorStore(getCursorStorePath(config));
    await cursorStore.load();

    const adapter = await startPassiveCodexAdapter({
      config,
      store,
      cursorStore,
      logger: pino({ level: "silent" }),
    });

    expect(watch).toHaveBeenCalledWith(
      [join(config.codexHome, "session_index.jsonl"), join(config.codexHome, "sessions")],
      expect.objectContaining({
        ignoreInitial: true,
      }),
    );

    const filePath = join(
      config.codexHome,
      "sessions",
      "2026",
      "03",
      "09",
      `rollout-2026-03-09T21-24-53-${TEST_SESSION_ID}.jsonl`,
    );

    await writeFile(filePath, await transcriptFixture(), "utf8");
    handlers.get("add")?.(filePath);

    await vi.waitFor(() => {
      expect(store.get(TEST_SESSION_ID)?.state).toBe("inactive");
      expect(store.get(TEST_SESSION_ID)?.cwd).toBe("/workspace/demo");
    });

    await adapter.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reads incremental transcript chunks without duplicating buffered lines", async () => {
    const { startPassiveCodexAdapter } = await import("../src/codex-adapter.js");
    const config = await createCodexHome();
    const store = new SessionStore();
    const cursorStore = new CursorStore(getCursorStorePath(config));
    await cursorStore.load();
    const adapter = await startPassiveCodexAdapter({
      config,
      store,
      cursorStore,
      logger: pino({ level: "silent" }),
    });
    const filePath = join(
      config.codexHome,
      "sessions",
      "2026",
      "03",
      "09",
      `rollout-2026-03-09T22-00-00-${TEST_SESSION_ID}.jsonl`,
    );

    await writeFile(
      filePath,
      [
        JSON.stringify({
          payload: {
            cwd: "/workspace/demo",
            id: TEST_SESSION_ID,
            source: "vscode",
          },
          timestamp: "2026-03-09T22:00:00.000Z",
          type: "session_meta",
        }),
        JSON.stringify({
          payload: {
            collaboration_mode_kind: "default",
            turn_id: "turn-1",
            type: "task_started",
          },
          timestamp: "2026-03-09T22:00:01.000Z",
          type: "event_msg",
        }),
      ].join("\n"),
      "utf8",
    );

    handlers.get("add")?.(filePath);
    await vi.waitFor(() => {
      expect(store.get(TEST_SESSION_ID)?.state).toBe("inactive");
    });

    await writeFile(
      filePath,
      [
        JSON.stringify({
          payload: {
            cwd: "/workspace/demo",
            id: TEST_SESSION_ID,
            source: "vscode",
          },
          timestamp: "2026-03-09T22:00:00.000Z",
          type: "session_meta",
        }),
        JSON.stringify({
          payload: {
            collaboration_mode_kind: "default",
            turn_id: "turn-1",
            type: "task_started",
          },
          timestamp: "2026-03-09T22:00:01.000Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: {
            turn_id: "turn-1",
            type: "task_complete",
          },
          timestamp: "2026-03-09T22:00:02.000Z",
          type: "event_msg",
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    handlers.get("change")?.(filePath);

    await vi.waitFor(() => {
      expect(store.get(TEST_SESSION_ID)?.state).toBe("inactive");
      expect(store.get(TEST_SESSION_ID)?.activeSubtasks).toBe(0);
    });

    await adapter.close();
  });

  it("resets the cursor when a transcript file is truncated and rewritten", async () => {
    const { startPassiveCodexAdapter } = await import("../src/codex-adapter.js");
    const config = await createCodexHome();
    const store = new SessionStore();
    const cursorStore = new CursorStore(getCursorStorePath(config));
    await cursorStore.load();
    const adapter = await startPassiveCodexAdapter({
      config,
      store,
      cursorStore,
      logger: pino({ level: "silent" }),
    });
    const filePath = join(
      config.codexHome,
      "sessions",
      "2026",
      "03",
      "09",
      `rollout-2026-03-09T22-10-00-${TEST_SESSION_ID}.jsonl`,
    );

    await writeFile(filePath, await transcriptFixture(), "utf8");
    handlers.get("add")?.(filePath);

    await vi.waitFor(() => {
      expect(store.get(TEST_SESSION_ID)?.state).toBe("inactive");
    });

    await writeFile(
      filePath,
      [
        JSON.stringify({
          payload: {
            cwd: "/workspace/demo",
            id: TEST_SESSION_ID,
            source: "vscode",
          },
          timestamp: "2026-03-09T22:10:00.000Z",
          type: "session_meta",
        }),
        JSON.stringify({
          payload: {
            collaboration_mode_kind: "default",
            turn_id: "turn-2",
            type: "task_started",
          },
          timestamp: "2026-03-09T22:10:01.000Z",
          type: "event_msg",
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    handlers.get("change")?.(filePath);

    await vi.waitFor(() => {
      expect(store.get(TEST_SESSION_ID)?.state).toBe("thinking");
      expect(store.get(TEST_SESSION_ID)?.activeSubtasks).toBe(1);
    });

    await adapter.close();
  });

  it("returns canceled turns to inactive after turn_aborted", async () => {
    const { startPassiveCodexAdapter } = await import("../src/codex-adapter.js");
    const config = await createCodexHome();
    const store = new SessionStore();
    const cursorStore = new CursorStore(getCursorStorePath(config));
    await cursorStore.load();
    const adapter = await startPassiveCodexAdapter({
      config,
      store,
      cursorStore,
      logger: pino({ level: "silent" }),
    });
    const filePath = join(
      config.codexHome,
      "sessions",
      "2026",
      "03",
      "09",
      `rollout-2026-03-09T23-13-51-${TEST_SESSION_ID}.jsonl`,
    );

    await writeFile(
      filePath,
      [
        JSON.stringify({
          payload: {
            cwd: "/workspace/demo",
            id: TEST_SESSION_ID,
            source: "vscode",
          },
          timestamp: "2026-03-09T23:13:51.000Z",
          type: "session_meta",
        }),
        JSON.stringify({
          payload: {
            collaboration_mode_kind: "default",
            turn_id: "turn-cancel",
            type: "task_started",
          },
          timestamp: "2026-03-09T23:13:51.151Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: {
            type: "turn_aborted",
          },
          timestamp: "2026-03-09T23:13:57.424Z",
          type: "event_msg",
        }),
        JSON.stringify({
          payload: {
            type: "thread_rolled_back",
          },
          timestamp: "2026-03-09T23:15:46.108Z",
          type: "event_msg",
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    handlers.get("add")?.(filePath);

    await vi.waitFor(() => {
      expect(store.get(TEST_SESSION_ID)?.state).toBe("inactive");
      expect(store.get(TEST_SESSION_ID)?.activeSubtasks).toBe(0);
    });

    await adapter.close();
  });

  it("limits bootstrap seeds and tracked offline history", async () => {
    const { startPassiveCodexAdapter } = await import("../src/codex-adapter.js");
    const config = await createCodexHome();
    const entries = Array.from({ length: 600 }, (_, index) => {
      const sessionId = `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`;
      return JSON.stringify({
        id: sessionId,
        thread_name: `Session ${index}`,
        updated_at: `2024-03-09T18:${String(index % 60).padStart(2, "0")}:00.000Z`,
      });
    }).join("\n");

    await writeFile(join(config.codexHome, "session_index.jsonl"), entries, "utf8");

    for (let index = 0; index < 600; index += 1) {
      const sessionId = `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`;
      const rolloutPath = join(
        config.codexHome,
        "sessions",
        "2026",
        "03",
        "09",
        `rollout-2026-03-09T19-${String(index % 60).padStart(2, "0")}-00-${sessionId}.jsonl`,
      );

      await writeFile(
        rolloutPath,
        [
          JSON.stringify({
            payload: {
              cwd: `/workspace/${index}`,
              id: sessionId,
              source: "vscode",
            },
            timestamp: `2024-03-09T18:${String(index % 60).padStart(2, "0")}:00.000Z`,
            type: "session_meta",
          }),
          JSON.stringify({
            payload: {
              turn_id: `turn-${index}`,
              type: "task_complete",
            },
            timestamp: `2024-03-09T18:${String(index % 60).padStart(2, "0")}:30.000Z`,
            type: "event_msg",
          }),
          "",
        ].join("\n"),
        "utf8",
      );
    }

    const store = new SessionStore({
      offlineHistoryCap: config.offlineHistoryCap,
    });
    const cursorStore = new CursorStore(getCursorStorePath(config));
    await cursorStore.load();
    const adapter = await startPassiveCodexAdapter({
      config,
      store,
      cursorStore,
      logger: pino({ level: "silent" }),
    });
    const metrics = adapter.getMetrics();

    expect(metrics.bootstrappedSeeds).toBe(config.bootstrapSeedLimit);
    expect(metrics.bootstrappedTranscripts).toBe(config.offlineHistoryCap);
    expect(store.listOffline()).toHaveLength(config.offlineHistoryCap);

    await adapter.close();
  });
});
