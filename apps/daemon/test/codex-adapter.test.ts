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
    codexHome: root,
    dataDir: join(root, "data"),
    idleMs: 120_000,
    port: 0,
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
      expect(store.get(TEST_SESSION_ID)?.state).toBe("waiting_user");
      expect(store.get(TEST_SESSION_ID)?.cwd).toBe("/workspace/demo");
    });

    await adapter.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
