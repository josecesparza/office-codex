import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSessionIndexLine, parseTranscriptLines } from "../src";

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

describe("parseSessionIndexLine", () => {
  it("parses a session index record", () => {
    const record = parseSessionIndexLine(
      JSON.stringify({
        id: "session-basic",
        thread_name: "Build office codex",
        updated_at: "2026-03-09T18:46:36.704Z",
      }),
    );

    expect(record).toEqual({
      id: "session-basic",
      threadName: "Build office codex",
      updatedAt: "2026-03-09T18:46:36.704Z",
    });
  });
});

describe("parseTranscriptLines", () => {
  it("normalizes supported JSONL transcript entries", () => {
    const entries = parseTranscriptLines(fixture("basic-session.jsonl"));

    expect(entries.map((entry) => entry.kind)).toEqual([
      "session_meta",
      "task_started",
      "reasoning",
      "function_call",
      "function_call_output",
      "message",
      "task_complete",
    ]);

    expect(entries[0]).toMatchObject({
      kind: "session_meta",
      sessionId: "session-basic",
      cwd: "/workspace/demo",
    });

    expect(entries[3]).toMatchObject({
      kind: "function_call",
      name: "exec_command",
      callId: "call-1",
    });
  });
});
