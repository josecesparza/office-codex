import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DEMO_SECONDS,
  parseCommand,
  parseDemoLiveArgs,
  stripRunSeparator,
} from "../src/command-helpers.js";
import {
  detectSessionId,
  inferCodexWorkingDirectory,
  runWrappedCodex,
} from "../src/wrapped-codex.js";

const execFile = promisify(execFileCallback);

describe("parseCommand", () => {
  it("removes the pnpm separator", () => {
    expect(parseCommand(["--", "doctor"])).toEqual({
      command: "doctor",
      args: [],
    });
  });

  it("normalizes wrapper separators", () => {
    expect(stripRunSeparator(["--", "--full-auto"])).toEqual(["--full-auto"]);
  });

  it("parses demo-live defaults", () => {
    expect(parseDemoLiveArgs([])).toEqual({
      help: false,
      seconds: DEFAULT_DEMO_SECONDS,
    });
  });

  it("parses demo-live options", () => {
    expect(parseDemoLiveArgs(["--seconds", "45"])).toEqual({
      help: false,
      seconds: 45,
    });
    expect(parseDemoLiveArgs(["--help"])).toEqual({
      help: true,
      seconds: DEFAULT_DEMO_SECONDS,
    });
  });

  it("detects the session id from Codex output", () => {
    expect(detectSessionId("session id: 019cd46b-7904-71a2-a937-d8ad8d389000")).toBe(
      "019cd46b-7904-71a2-a937-d8ad8d389000",
    );
    expect(detectSessionId("no session here")).toBeNull();
  });

  it("infers the working directory from -C and --cd", () => {
    expect(inferCodexWorkingDirectory(["-C", "demo"], "/tmp/root")).toBe("/tmp/root/demo");
    expect(inferCodexWorkingDirectory(["--cd=/tmp/other"], "/tmp/root")).toBe("/tmp/other");
  });
});

describe("office-codex doctor", () => {
  it("prints diagnostics for a mocked Codex home", async () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const fixtureHome = resolve(repoRoot, "tests/fixtures/codex-home");
    const { stdout } = await execFile(
      process.execPath,
      ["--import", "tsx", "apps/cli/src/index.ts", "doctor"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          OFFICE_CODEX_CODEX_HOME: fixtureHome,
        },
      },
    );

    const payload = JSON.parse(stdout) as {
      bootstrapSeedLimit: number;
      codexHome: string;
      codexHomeExists: boolean;
      cursorFlushMs: number;
      dbReader: string;
      historyCap: number;
      idleMs: number;
      sessionsDirExists: boolean;
      sessionIndexExists: boolean;
      wrapperHintTtlMs: number;
    };

    expect(payload.bootstrapSeedLimit).toBe(500);
    expect(payload.codexHome).toBe(fixtureHome);
    expect(payload.codexHomeExists).toBe(true);
    expect(payload.cursorFlushMs).toBe(500);
    expect(payload.dbReader).toMatch(/better-sqlite3|sqlite3|unavailable/);
    expect(payload.historyCap).toBe(200);
    expect(payload.idleMs).toBe(120000);
    expect(payload.sessionIndexExists).toBe(true);
    expect(payload.sessionsDirExists).toBe(true);
    expect(payload.wrapperHintTtlMs).toBe(120000);
  });
});

describe("office-codex help", () => {
  it("prints help for demo-live", async () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const { stdout } = await execFile(
      process.execPath,
      ["--import", "tsx", "apps/cli/src/index.ts", "demo-live", "--help"],
      {
        cwd: repoRoot,
      },
    );

    expect(stdout).toContain("office-codex demo-live [options]");
    expect(stdout).toContain("--seconds <n>");
  });
});

describe("office-codex run", () => {
  it("posts wrapper lifecycle events while streaming Codex output", async () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const binDir = await mkdtemp(resolve(tmpdir(), "office-codex-cli-bin-"));
    const fakeCodexPath = resolve(binDir, "codex");
    const events: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === "string") {
          events.push(JSON.parse(init.body) as Record<string, unknown>);
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 202,
        });
      }),
    );

    await writeFile(
      fakeCodexPath,
      [
        "#!/bin/sh",
        'echo "OpenAI Codex test build"',
        'echo "session id: 019cd46b-7904-71a2-a937-d8ad8d389000"',
        'echo "done"',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodexPath, 0o755);

    await runWrappedCodex({
      args: ["exec", "fake"],
      binary: fakeCodexPath,
      cwd: repoRoot,
      port: 3310,
    });

    expect(events.map((event) => event.type)).toEqual(["launch", "identified", "exit"]);
    expect(events[0]?.cwd).toBe(repoRoot);
    expect(events[1]?.sessionId).toBe("019cd46b-7904-71a2-a937-d8ad8d389000");
    expect(events[2]?.exitCode).toBe(0);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
