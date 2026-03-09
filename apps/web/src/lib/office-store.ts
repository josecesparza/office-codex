import { create } from "zustand";

import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentSession,
  type OfficeLayout,
} from "@office-codex/core";

export type ConnectionState = "connecting" | "ready" | "error";

export interface EventEnvelope {
  event: AgentEvent;
  session: AgentSession | null;
}

interface OfficeState {
  connection: ConnectionState;
  layout: OfficeLayout | null;
  sessions: AgentSession[];
  lastMutationAt: number;
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

export const daemonEventTypes = [...AGENT_EVENT_TYPES];

export const useOfficeStore = create<OfficeState>((set) => ({
  connection: "connecting",
  layout: null,
  sessions: [],
  lastMutationAt: Date.now(),
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
    set({
      sessions: sortSessions(sessions),
      lastMutationAt: Date.now(),
    });
  },
  applyEnvelope(envelope) {
    set((state) => ({
      sessions: envelope.session ? upsertSession(state.sessions, envelope.session) : state.sessions,
      lastMutationAt: Date.now(),
    }));
  },
}));
