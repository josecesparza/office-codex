import { create } from "zustand";

import {
  AGENT_EVENT_TYPES,
  type AccountUsageStatus,
  type AgentEvent,
  type AgentEventType,
  type AgentSession,
  type AgentState,
  type OfficeLayout,
} from "@office-codex/core";

export type ConnectionState = "connecting" | "ready" | "error";

export interface EventEnvelope {
  event: AgentEvent;
  session: AgentSession | null;
}

export interface SessionActivityItem {
  id: string;
  state: AgentState;
  timestamp: string;
  tool: string | null;
  type: AgentEventType | "snapshot";
  label: string;
}

interface OfficeState {
  account: AccountUsageStatus | null;
  activityBySession: Record<string, SessionActivityItem[]>;
  connection: ConnectionState;
  layout: OfficeLayout | null;
  sessions: AgentSession[];
  lastMutationAt: number;
  setAccount(account: AccountUsageStatus): void;
  setConnection(connection: ConnectionState): void;
  setLayout(layout: OfficeLayout): void;
  setSnapshot(sessions: AgentSession[]): void;
  applyEnvelope(envelope: EventEnvelope): void;
}

function sortSessions(sessions: AgentSession[]): AgentSession[] {
  return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function upsertSession(list: AgentSession[], session: AgentSession): AgentSession[] {
  const next = list.filter((candidate) => candidate.sessionId !== session.sessionId);
  next.push(session);
  return sortSessions(next);
}

function describeActivityLabel(item: {
  activeSubtasks: number;
  currentTool: string | null;
  details: string | null;
  state: AgentState;
  type: AgentEventType | "snapshot";
}): string {
  switch (item.type) {
    case "snapshot":
      return `Current state: ${item.state.replaceAll("_", " ")}`;
    case "tool_started":
      return `Started ${item.details ?? item.currentTool ?? "tool"}`;
    case "tool_finished":
      return `Finished ${item.details ?? "tool"}`;
    case "state_changed":
      return `State -> ${item.state.replaceAll("_", " ")}`;
    case "subtasks_changed":
      return `Subtasks: ${item.activeSubtasks}`;
    case "session_discovered":
      return "Session discovered";
    case "session_exited":
      return "Session exited";
    case "session_updated":
      return "Session updated";
  }
}

function seedActivity(session: AgentSession): SessionActivityItem {
  return {
    id: `${session.sessionId}:snapshot:${session.updatedAt}`,
    label: describeActivityLabel({
      activeSubtasks: session.activeSubtasks,
      currentTool: session.currentTool,
      details: null,
      state: session.state,
      type: "snapshot",
    }),
    state: session.state,
    timestamp: session.updatedAt,
    tool: session.currentTool,
    type: "snapshot",
  };
}

function appendActivity(
  current: Record<string, SessionActivityItem[]>,
  envelope: EventEnvelope,
): Record<string, SessionActivityItem[]> {
  const { event, session } = envelope;
  const next = { ...current };
  const existing = next[event.sessionId] ?? (session ? [seedActivity(session)] : []);

  if (event.type === "session_updated") {
    next[event.sessionId] = existing;
    return next;
  }

  const activity: SessionActivityItem = {
    id: `${event.sessionId}:${event.type}:${event.timestamp}`,
    label: describeActivityLabel(event),
    state: event.state,
    timestamp: event.timestamp,
    tool: event.details ?? event.currentTool,
    type: event.type,
  };
  const deduped = existing.filter((item) => item.id !== activity.id);

  next[event.sessionId] = [activity, ...deduped].slice(0, 8);
  return next;
}

function seedActivities(
  sessions: AgentSession[],
  current: Record<string, SessionActivityItem[]>,
): Record<string, SessionActivityItem[]> {
  const next: Record<string, SessionActivityItem[]> = {};

  for (const session of sessions) {
    next[session.sessionId] = current[session.sessionId] ?? [seedActivity(session)];
  }

  return next;
}

export const daemonEventTypes = [...AGENT_EVENT_TYPES];

export const useOfficeStore = create<OfficeState>((set) => ({
  account: null,
  activityBySession: {},
  connection: "connecting",
  layout: null,
  sessions: [],
  lastMutationAt: Date.now(),
  setAccount(account) {
    set({ account });
  },
  setConnection(connection) {
    set({ connection });
  },
  setLayout(layout) {
    set({
      layout,
      lastMutationAt: Date.now(),
    });
  },
  setSnapshot(sessions) {
    set((state) => ({
      activityBySession: seedActivities(sessions, state.activityBySession),
      sessions: sortSessions(sessions),
      lastMutationAt: Date.now(),
    }));
  },
  applyEnvelope(envelope) {
    set((state) => ({
      activityBySession: appendActivity(state.activityBySession, envelope),
      sessions: envelope.session ? upsertSession(state.sessions, envelope.session) : state.sessions,
      lastMutationAt: Date.now(),
    }));
  },
}));
