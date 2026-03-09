import { createAgentSession } from "./session.js";
import type { AgentEvent, AgentSession, AgentSessionSeed, ParsedTranscriptEntry } from "./types.js";

export interface ApplyTranscriptEntryResult {
  session: AgentSession;
  emitted: AgentEvent[];
}

function createEvent(
  session: AgentSession,
  type: AgentEvent["type"],
  timestamp: string,
  details: string | null = null,
): AgentEvent {
  return {
    type,
    sessionId: session.sessionId,
    timestamp,
    state: session.state,
    currentTool: session.currentTool,
    activeSubtasks: session.activeSubtasks,
    details,
  };
}

function finalizeUpdate(
  session: AgentSession,
  timestamp: string,
  emitted: AgentEvent[],
): ApplyTranscriptEntryResult {
  session.updatedAt = timestamp;
  session.lastEventAt = timestamp;
  session.lastEventType = emitted.at(-1)?.type ?? session.lastEventType;

  emitted.push(createEvent(session, "session_updated", timestamp));
  session.lastEventType = "session_updated";

  return { session, emitted };
}

function transitionState(
  session: AgentSession,
  nextState: AgentSession["state"],
  timestamp: string,
  emitted: AgentEvent[],
): void {
  if (session.state === nextState) {
    return;
  }

  session.state = nextState;
  emitted.push(createEvent(session, "state_changed", timestamp));
}

function updateSubtasks(
  session: AgentSession,
  nextCount: number,
  timestamp: string,
  emitted: AgentEvent[],
): void {
  if (session.activeSubtasks === nextCount) {
    return;
  }

  session.activeSubtasks = nextCount;
  emitted.push(createEvent(session, "subtasks_changed", timestamp));
}

function clearCurrentTool(
  session: AgentSession,
  timestamp: string,
  emitted: AgentEvent[],
  fallbackState: AgentSession["state"] = "thinking",
): void {
  if (!session.currentTool) {
    return;
  }

  const finishedTool = session.currentTool;
  session.currentTool = null;
  emitted.push(createEvent(session, "tool_finished", timestamp, finishedTool));

  if (session.state === "using_tool") {
    transitionState(session, fallbackState, timestamp, emitted);
  }
}

export function applyTranscriptEntry(
  session: AgentSession,
  entry: ParsedTranscriptEntry,
): ApplyTranscriptEntryResult {
  const nextSession: AgentSession = { ...session };
  const emitted: AgentEvent[] = [];

  switch (entry.kind) {
    case "session_meta":
      nextSession.cwd = entry.cwd;
      nextSession.source = entry.source;
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "task_started":
      updateSubtasks(nextSession, nextSession.activeSubtasks + 1, entry.timestamp, emitted);
      transitionState(nextSession, "thinking", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "reasoning":
      transitionState(nextSession, "thinking", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "function_call":
      nextSession.currentTool = entry.name;
      emitted.push(createEvent(nextSession, "tool_started", entry.timestamp, entry.name));
      transitionState(
        nextSession,
        entry.name === "request_user_input" ? "waiting_user" : "using_tool",
        entry.timestamp,
        emitted,
      );
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "function_call_output":
      clearCurrentTool(nextSession, entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "message":
      if (entry.role === "assistant") {
        transitionState(nextSession, "responding", entry.timestamp, emitted);
      }
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "agent_message":
      transitionState(nextSession, "responding", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "user_message":
      transitionState(nextSession, "thinking", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "task_complete":
      updateSubtasks(
        nextSession,
        Math.max(nextSession.activeSubtasks - 1, 0),
        entry.timestamp,
        emitted,
      );
      if (nextSession.state === "waiting_user") {
        clearCurrentTool(nextSession, entry.timestamp, emitted, "waiting_user");
        return finalizeUpdate(nextSession, entry.timestamp, emitted);
      }

      clearCurrentTool(nextSession, entry.timestamp, emitted, "inactive");
      transitionState(nextSession, "inactive", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "turn_aborted":
      updateSubtasks(
        nextSession,
        Math.max(nextSession.activeSubtasks - 1, 0),
        entry.timestamp,
        emitted,
      );
      clearCurrentTool(nextSession, entry.timestamp, emitted, "inactive");
      transitionState(nextSession, "inactive", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);

    case "thread_rolled_back":
      clearCurrentTool(nextSession, entry.timestamp, emitted, "inactive");
      transitionState(nextSession, "inactive", entry.timestamp, emitted);
      return finalizeUpdate(nextSession, entry.timestamp, emitted);
  }

  throw new Error(`Unsupported transcript entry: ${JSON.stringify(entry)}`);
}

export function reduceTranscriptEntries(
  seed: AgentSessionSeed,
  entries: ParsedTranscriptEntry[],
): ApplyTranscriptEntryResult {
  let current = createAgentSession(seed);
  const emitted: AgentEvent[] = [createEvent(current, "session_discovered", current.startedAt)];

  for (const entry of entries) {
    const next = applyTranscriptEntry(current, entry);
    current = next.session;
    emitted.push(...next.emitted);
  }

  return { session: current, emitted };
}
