import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { parseCommand, stripRunSeparator } from "../src/command-helpers.js";

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
      codexHome: string;
      codexHomeExists: boolean;
      sessionsDirExists: boolean;
      sessionIndexExists: boolean;
    };

    expect(payload.codexHome).toBe(fixtureHome);
    expect(payload.codexHomeExists).toBe(true);
    expect(payload.sessionIndexExists).toBe(true);
    expect(payload.sessionsDirExists).toBe(true);
  });
});
