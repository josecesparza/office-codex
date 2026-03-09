import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTranscriptLines, reduceTranscriptEntries } from "../src";

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

describe("reduceTranscriptEntries", () => {
  it("drives a session through tool usage back to inactive after task completion", () => {
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

    expect(result.session.state).toBe("inactive");
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

  it("keeps waiting_user after request_user_input even when the task completes", () => {
    const result = reduceTranscriptEntries(
      {
        sessionId: "session-awaiting",
        source: "vscode",
        title: "Office Codex",
        cwd: "/workspace/demo",
        rolloutPath: "/tmp/request-user-input-complete.jsonl",
        startedAt: "2026-03-09T19:21:00.000Z",
      },
      parseTranscriptLines(`
{"timestamp":"2026-03-09T19:21:00.000Z","type":"session_meta","payload":{"id":"session-awaiting","timestamp":"2026-03-09T19:21:00.000Z","cwd":"/workspace/demo","originator":"Codex Desktop","cli_version":"0.108.0-alpha.12","source":"vscode","model_provider":"openai"}}
{"timestamp":"2026-03-09T19:21:01.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-3","collaboration_mode_kind":"plan"}}
{"timestamp":"2026-03-09T19:21:02.000Z","type":"response_item","payload":{"type":"function_call","name":"request_user_input","arguments":"{\\\"questions\\\":[]}","call_id":"call-await"}}
{"timestamp":"2026-03-09T19:21:03.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call-await","output":"{\\\"answers\\\":{}}"}}
{"timestamp":"2026-03-09T19:21:04.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-3","last_agent_message":"Awaiting user input"}}
      `),
    );

    expect(result.session.state).toBe("waiting_user");
    expect(result.session.activeSubtasks).toBe(0);
  });

  it("returns the parent session to inactive while keeping parallel subtasks tracked", () => {
    const result = reduceTranscriptEntries(
      {
        sessionId: "session-parallel",
        source: "vscode",
        title: "Office Codex",
        cwd: "/workspace/demo",
        rolloutPath: "/tmp/parallel-session.jsonl",
        startedAt: "2026-03-09T19:22:00.000Z",
      },
      parseTranscriptLines(`
{"timestamp":"2026-03-09T19:22:00.000Z","type":"session_meta","payload":{"id":"session-parallel","timestamp":"2026-03-09T19:22:00.000Z","cwd":"/workspace/demo","originator":"Codex Desktop","cli_version":"0.108.0-alpha.12","source":"vscode","model_provider":"openai"}}
{"timestamp":"2026-03-09T19:22:01.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","collaboration_mode_kind":"default"}}
{"timestamp":"2026-03-09T19:22:02.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-2","collaboration_mode_kind":"default"}}
{"timestamp":"2026-03-09T19:22:03.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","last_agent_message":"One parallel branch finished"}}
      `),
    );

    expect(result.session.state).toBe("inactive");
    expect(result.session.activeSubtasks).toBe(1);
  });

  it("returns the session to inactive after a canceled turn", () => {
    const result = reduceTranscriptEntries(
      {
        sessionId: "session-cancelled",
        source: "vscode",
        title: "Office Codex",
        cwd: "/workspace/demo",
        rolloutPath: "/tmp/cancelled-session.jsonl",
        startedAt: "2026-03-09T23:13:51.000Z",
      },
      parseTranscriptLines(`
{"timestamp":"2026-03-09T23:13:51.000Z","type":"session_meta","payload":{"id":"session-cancelled","timestamp":"2026-03-09T23:13:51.000Z","cwd":"/workspace/demo","originator":"Codex Desktop","cli_version":"0.108.0-alpha.12","source":"vscode","model_provider":"openai"}}
{"timestamp":"2026-03-09T23:13:51.151Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-cancel","collaboration_mode_kind":"default"}}
{"timestamp":"2026-03-09T23:13:53.859Z","type":"response_item","payload":{"type":"reasoning","summary":[],"content":null}}
{"timestamp":"2026-03-09T23:13:57.424Z","type":"event_msg","payload":{"type":"turn_aborted"}}
{"timestamp":"2026-03-09T23:15:46.108Z","type":"event_msg","payload":{"type":"thread_rolled_back"}}
      `),
    );

    expect(result.session.state).toBe("inactive");
    expect(result.session.activeSubtasks).toBe(0);
  });
});
