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

export interface SessionCollectionMeta {
  hasMoreHistory: boolean;
  historyCap: number;
  liveCount: number;
  nextBefore: string | null;
  offlineCount: number;
  trackedCount: number;
}

interface OfficeState {
  account: AccountUsageStatus | null;
  activityBySession: Record<string, SessionActivityItem[]>;
  connection: ConnectionState;
  historySessions: AgentSession[];
  layout: OfficeLayout | null;
  liveSessions: AgentSession[];
  sessionMeta: SessionCollectionMeta | null;
  sessions: AgentSession[];
  lastMutationAt: number;
  setAccount(account: AccountUsageStatus): void;
  setConnection(connection: ConnectionState): void;
  setHistoryPage(
    sessions: AgentSession[],
    meta: SessionCollectionMeta,
    mode: "append" | "replace",
  ): void;
  setLayout(layout: OfficeLayout): void;
  setLiveSnapshot(sessions: AgentSession[], meta: SessionCollectionMeta): void;
  setSnapshot(sessions: AgentSession[], meta?: SessionCollectionMeta): void;
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

function mergeSessions(base: AgentSession[], incoming: AgentSession[]): AgentSession[] {
  const byId = new Map<string, AgentSession>();

  for (const session of base) {
    byId.set(session.sessionId, session);
  }

  for (const session of incoming) {
    byId.set(session.sessionId, session);
  }

  return sortSessions([...byId.values()]);
}

function buildCombinedSessions(
  liveSessions: AgentSession[],
  historySessions: AgentSession[],
): AgentSession[] {
  return mergeSessions(liveSessions, historySessions);
}

function deriveMeta(
  liveSessions: AgentSession[],
  historySessions: AgentSession[],
): SessionCollectionMeta {
  return {
    hasMoreHistory: false,
    historyCap: Math.max(historySessions.length, 200),
    liveCount: liveSessions.length,
    nextBefore: historySessions.at(-1)?.updatedAt ?? null,
    offlineCount: historySessions.length,
    trackedCount: liveSessions.length + historySessions.length,
  };
}

function mergeQueryMeta(
  current: SessionCollectionMeta | null,
  incoming: SessionCollectionMeta,
): SessionCollectionMeta {
  if (!current) {
    return incoming;
  }

  return {
    ...current,
    ...incoming,
  };
}

function patchMetaForSession(
  current: SessionCollectionMeta | null,
  previousSession: AgentSession | undefined,
  nextSession: AgentSession,
  loadedHistoryCount: number,
): SessionCollectionMeta {
  const nextMeta = current
    ? { ...current }
    : deriveMeta(
        previousSession?.state === "offline" ? [] : previousSession ? [previousSession] : [],
        previousSession?.state === "offline" ? [previousSession] : [],
      );
  const previousState = previousSession?.state ?? null;
  const nextState = nextSession.state;

  if (!previousSession) {
    nextMeta.trackedCount += 1;
    if (nextState === "offline") {
      nextMeta.offlineCount += 1;
    } else {
      nextMeta.liveCount += 1;
    }
  } else if (previousState === "offline" && nextState !== "offline") {
    nextMeta.offlineCount = Math.max(0, nextMeta.offlineCount - 1);
    nextMeta.liveCount += 1;
  } else if (previousState !== "offline" && nextState === "offline") {
    nextMeta.liveCount = Math.max(0, nextMeta.liveCount - 1);
    nextMeta.offlineCount += 1;
  }

  nextMeta.hasMoreHistory = nextMeta.offlineCount > loadedHistoryCount;
  nextMeta.nextBefore =
    nextMeta.hasMoreHistory && loadedHistoryCount > 0 ? nextSession.updatedAt : null;
  return nextMeta;
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
  historySessions: [],
  layout: null,
  liveSessions: [],
  sessionMeta: null,
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
  setLiveSnapshot(sessions, meta) {
    set((state) => {
      const nextLiveSessions = sortSessions(
        sessions.filter((session) => session.state !== "offline"),
      );
      const liveIds = new Set(nextLiveSessions.map((session) => session.sessionId));
      const nextHistorySessions = sortSessions(
        state.historySessions.filter((session) => !liveIds.has(session.sessionId)),
      );
      const nextSessions = buildCombinedSessions(nextLiveSessions, nextHistorySessions);

      return {
        activityBySession: seedActivities(nextSessions, state.activityBySession),
        liveSessions: nextLiveSessions,
        historySessions: nextHistorySessions,
        sessionMeta: mergeQueryMeta(state.sessionMeta, meta),
        sessions: nextSessions,
        lastMutationAt: Date.now(),
      };
    });
  },
  setHistoryPage(sessions, meta, mode) {
    set((state) => {
      const liveIds = new Set(state.liveSessions.map((session) => session.sessionId));
      const nextHistorySessions = (
        mode === "replace" ? sortSessions(sessions) : mergeSessions(state.historySessions, sessions)
      ).filter((session) => session.state === "offline" && !liveIds.has(session.sessionId));
      const nextSessions = buildCombinedSessions(state.liveSessions, nextHistorySessions);

      return {
        activityBySession: seedActivities(nextSessions, state.activityBySession),
        historySessions: nextHistorySessions,
        sessionMeta: mergeQueryMeta(state.sessionMeta, meta),
        sessions: nextSessions,
        lastMutationAt: Date.now(),
      };
    });
  },
  setSnapshot(sessions, meta) {
    set((state) => ({
      activityBySession: seedActivities(sessions, state.activityBySession),
      historySessions: sortSessions(sessions.filter((session) => session.state === "offline")),
      liveSessions: sortSessions(sessions.filter((session) => session.state !== "offline")),
      sessionMeta: meta ? mergeQueryMeta(state.sessionMeta, meta) : state.sessionMeta,
      sessions: sortSessions(sessions),
      lastMutationAt: Date.now(),
    }));
  },
  applyEnvelope(envelope) {
    set((state) => {
      if (!envelope.session) {
        return {
          activityBySession: appendActivity(state.activityBySession, envelope),
          lastMutationAt: Date.now(),
        };
      }

      const previousSession =
        state.liveSessions.find((session) => session.sessionId === envelope.session?.sessionId) ??
        state.historySessions.find((session) => session.sessionId === envelope.session?.sessionId);

      const liveSessions =
        envelope.session.state === "offline"
          ? state.liveSessions.filter(
              (session) => session.sessionId !== envelope.session?.sessionId,
            )
          : upsertSession(state.liveSessions, envelope.session);
      const historySessions =
        envelope.session.state === "offline"
          ? upsertSession(
              state.historySessions.filter(
                (session) => session.sessionId !== envelope.session?.sessionId,
              ),
              envelope.session,
            )
          : state.historySessions.filter(
              (session) => session.sessionId !== envelope.session?.sessionId,
            );
      const nextSessions = buildCombinedSessions(liveSessions, historySessions);

      return {
        activityBySession: appendActivity(state.activityBySession, envelope),
        historySessions,
        liveSessions,
        sessionMeta: patchMetaForSession(
          state.sessionMeta,
          previousSession,
          envelope.session,
          historySessions.length,
        ),
        sessions: nextSessions,
        lastMutationAt: Date.now(),
      };
    });
  },
}));
