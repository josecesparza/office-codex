import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTranscriptLines, reduceTranscriptEntries } from "../src";

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

describe("reduceTranscriptEntries", () => {
  it("drives a session through tool usage back to waiting_user", () => {
    const result = reduceTranscriptEntries(
      {
        sessionId: "session-basic",
        source: "vscode",
        title: "Office Codex",
        cwd: "/workspace/demo",
        rolloutPath: "/tmp/basic-session.jsonl",
        startedAt: "2026-03-09T18:46:36.704Z",
      },
      parseTranscriptLines(fixture("basic-session.jsonl")),
    );

    expect(result.session.state).toBe("waiting_user");
    expect(result.session.currentTool).toBeNull();
    expect(result.session.activeSubtasks).toBe(0);

    expect(result.emitted.map((event) => event.type)).toContain("tool_started");
    expect(result.emitted.map((event) => event.type)).toContain("tool_finished");
    expect(result.emitted.map((event) => event.type)).toContain("subtasks_changed");
  });

  it("keeps the session in waiting_user after request_user_input", () => {
    const result = reduceTranscriptEntries(
      {
        sessionId: "session-input",
        source: "vscode",
        title: "Office Codex",
        cwd: "/workspace/demo",
        rolloutPath: "/tmp/request-user-input.jsonl",
        startedAt: "2026-03-09T19:20:00.000Z",
      },
      parseTranscriptLines(fixture("request-user-input.jsonl")),
    );

    expect(result.session.state).toBe("waiting_user");
    expect(result.session.currentTool).toBeNull();

    const stateChanges = result.emitted.filter((event) => event.type === "state_changed");
    expect(stateChanges.at(-1)?.state).toBe("waiting_user");
  });
});
