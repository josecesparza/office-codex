import { z } from "zod";

import type { ParsedTranscriptEntry, SessionIndexRecord } from "./types.js";

const sessionIndexSchema = z.object({
  id: z.string().min(1),
  thread_name: z.string().min(1),
  updated_at: z.string().min(1),
});

const rawTranscriptSchema = z.object({
  timestamp: z.string().min(1).optional(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function getTimestamp(raw: z.infer<typeof rawTranscriptSchema>): string | null {
  const payloadTimestamp = raw.payload?.timestamp;

  if (typeof payloadTimestamp === "string" && payloadTimestamp.length > 0) {
    return payloadTimestamp;
  }

  return raw.timestamp ?? null;
}

export function parseSessionIndexLine(line: string): SessionIndexRecord | null {
  const parsed = sessionIndexSchema.safeParse(parseJsonLine(line));

  if (!parsed.success) {
    return null;
  }

  return {
    id: parsed.data.id,
    threadName: parsed.data.thread_name,
    updatedAt: parsed.data.updated_at,
  };
}

export function parseTranscriptLine(line: string): ParsedTranscriptEntry | null {
  const parsed = rawTranscriptSchema.safeParse(parseJsonLine(line));

  if (!parsed.success) {
    return null;
  }

  const raw = parsed.data;
  const timestamp = getTimestamp(raw);

  if (!timestamp || !raw.payload) {
    return null;
  }

  switch (raw.type) {
    case "session_meta":
      if (
        typeof raw.payload.id === "string" &&
        typeof raw.payload.cwd === "string" &&
        typeof raw.payload.source === "string"
      ) {
        return {
          kind: "session_meta",
          timestamp,
          sessionId: raw.payload.id,
          cwd: raw.payload.cwd,
          source: raw.payload.source,
          originator: typeof raw.payload.originator === "string" ? raw.payload.originator : null,
        };
      }
      return null;

    case "response_item":
      if (typeof raw.payload.type !== "string") {
        return null;
      }

      switch (raw.payload.type) {
        case "reasoning":
          return {
            kind: "reasoning",
            timestamp,
          };
        case "function_call":
          if (
            typeof raw.payload.call_id === "string" &&
            typeof raw.payload.name === "string" &&
            typeof raw.payload.arguments === "string"
          ) {
            return {
              kind: "function_call",
              timestamp,
              callId: raw.payload.call_id,
              name: raw.payload.name,
              arguments: raw.payload.arguments,
            };
          }
          return null;
        case "function_call_output":
          if (typeof raw.payload.call_id === "string" && typeof raw.payload.output === "string") {
            return {
              kind: "function_call_output",
              timestamp,
              callId: raw.payload.call_id,
              output: raw.payload.output,
            };
          }
          return null;
        case "message":
          return {
            kind: "message",
            timestamp,
            role: typeof raw.payload.role === "string" ? raw.payload.role : null,
          };
        default:
          return null;
      }

    case "event_msg":
      if (typeof raw.payload.type !== "string") {
        return null;
      }

      switch (raw.payload.type) {
        case "agent_message":
          return {
            kind: "agent_message",
            timestamp,
            phase: typeof raw.payload.phase === "string" ? raw.payload.phase : null,
          };
        case "user_message":
          return {
            kind: "user_message",
            timestamp,
          };
        case "task_started":
          return {
            kind: "task_started",
            timestamp,
            turnId: typeof raw.payload.turn_id === "string" ? raw.payload.turn_id : null,
            collaborationMode:
              typeof raw.payload.collaboration_mode_kind === "string"
                ? raw.payload.collaboration_mode_kind
                : null,
          };
        case "task_complete":
          return {
            kind: "task_complete",
            timestamp,
            turnId: typeof raw.payload.turn_id === "string" ? raw.payload.turn_id : null,
          };
        case "turn_aborted":
          return {
            kind: "turn_aborted",
            timestamp,
          };
        case "thread_rolled_back":
          return {
            kind: "thread_rolled_back",
            timestamp,
          };
        default:
          return null;
      }

    default:
      return null;
  }
}

export function parseTranscriptLines(contents: string): ParsedTranscriptEntry[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed = parseTranscriptLine(line);
      return parsed ? [parsed] : [];
    });
}
