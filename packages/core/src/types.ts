export const AGENT_STATES = [
  "inactive",
  "thinking",
  "using_tool",
  "responding",
  "waiting_user",
  "offline",
  "error",
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export const AGENT_EVENT_TYPES = [
  "session_discovered",
  "session_updated",
  "state_changed",
  "tool_started",
  "tool_finished",
  "subtasks_changed",
  "session_exited",
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export const WRAPPER_EVENT_TYPES = ["launch", "identified", "exit"] as const;

export type WrapperEventType = (typeof WRAPPER_EVENT_TYPES)[number];

export interface AgentSession {
  sessionId: string;
  source: string;
  title: string;
  cwd: string;
  gitBranch: string | null;
  tokensUsed: number | null;
  rolloutPath: string;
  startedAt: string;
  updatedAt: string;
  seatId: string | null;
  activeSubtasks: number;
  currentTool: string | null;
  state: AgentState;
  lastEventAt: string;
  lastEventType: AgentEventType | null;
}

export interface AgentSessionSeed {
  sessionId: string;
  source: string;
  title: string;
  cwd: string;
  rolloutPath: string;
  startedAt: string;
  updatedAt?: string;
  gitBranch?: string | null;
  tokensUsed?: number | null;
  seatId?: string | null;
}

export interface AgentEvent {
  type: AgentEventType;
  sessionId: string;
  timestamp: string;
  state: AgentState;
  currentTool: string | null;
  activeSubtasks: number;
  details: string | null;
}

export interface DeskAnchor {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface OfficeLayout {
  tileSize: number;
  width: number;
  height: number;
  desks: DeskAnchor[];
}

export interface AccountUsageStatus {
  status: "available" | "unavailable" | "error";
  remainingLabel?: string;
  resetsAt?: string;
  source?: string;
}

interface WrapperEventBase {
  argv: string[];
  cwd: string;
  pid: number;
}

export interface WrapperLaunchEvent extends WrapperEventBase {
  type: "launch";
  startedAt: string;
}

export interface WrapperIdentifiedEvent extends WrapperEventBase {
  type: "identified";
  sessionId: string;
  startedAt: string;
}

export interface WrapperExitEvent {
  type: "exit";
  exitedAt: string;
  exitCode: number | null;
  pid: number;
  sessionId?: string;
}

export type WrapperEvent = WrapperLaunchEvent | WrapperIdentifiedEvent | WrapperExitEvent;

export interface SessionIndexRecord {
  id: string;
  threadName: string;
  updatedAt: string;
}

interface TranscriptBase {
  timestamp: string;
}

export interface SessionMetaEntry extends TranscriptBase {
  kind: "session_meta";
  sessionId: string;
  cwd: string;
  source: string;
  originator: string | null;
}

export interface ReasoningEntry extends TranscriptBase {
  kind: "reasoning";
}

export interface FunctionCallEntry extends TranscriptBase {
  kind: "function_call";
  callId: string;
  name: string;
  arguments: string;
}

export interface FunctionCallOutputEntry extends TranscriptBase {
  kind: "function_call_output";
  callId: string;
  output: string;
}

export interface MessageEntry extends TranscriptBase {
  kind: "message";
  role: string | null;
}

export interface AgentMessageEntry extends TranscriptBase {
  kind: "agent_message";
  phase: string | null;
}

export interface UserMessageEntry extends TranscriptBase {
  kind: "user_message";
}

export interface TaskStartedEntry extends TranscriptBase {
  kind: "task_started";
  turnId: string | null;
  collaborationMode: string | null;
}

export interface TaskCompleteEntry extends TranscriptBase {
  kind: "task_complete";
  turnId: string | null;
}

export type ParsedTranscriptEntry =
  | SessionMetaEntry
  | ReasoningEntry
  | FunctionCallEntry
  | FunctionCallOutputEntry
  | MessageEntry
  | AgentMessageEntry
  | UserMessageEntry
  | TaskStartedEntry
  | TaskCompleteEntry;
