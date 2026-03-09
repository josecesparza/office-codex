import { EventEmitter } from "node:events";

import {
  type AgentEvent,
  type AgentSession,
  applyTranscriptEntry,
  createAgentSession,
} from "@office-codex/core";
import type { AgentSessionSeed, ParsedTranscriptEntry } from "@office-codex/core";

import { pickPreferredTitle } from "./session-titles.js";

export type SessionQueryScope = "all" | "history" | "live";

export interface SessionSeedPatch {
  sessionId: string;
  source?: string;
  title?: string;
  cwd?: string;
  rolloutPath?: string;
  startedAt?: string;
  updatedAt?: string;
  gitBranch?: string | null;
  tokensUsed?: number | null;
  seatId?: string | null;
}

export interface SessionQuery {
  before?: string;
  limit?: number;
  scope: SessionQueryScope;
}

export interface SessionQueryMeta {
  hasMoreHistory: boolean;
  historyCap: number;
  liveCount: number;
  nextBefore: string | null;
  offlineCount: number;
  trackedCount: number;
}

export interface SessionQueryResult {
  meta: SessionQueryMeta;
  sessions: AgentSession[];
}

export interface SessionStoreOptions {
  offlineHistoryCap?: number;
}

interface MarkOfflineOptions {
  details?: string | null;
  preserveUpdatedAt?: boolean;
}

function mergeSessionSeed(session: AgentSession, seed: SessionSeedPatch): AgentSession {
  return {
    ...session,
    source: seed.source ?? session.source,
    title: seed.title !== undefined ? pickPreferredTitle(session.title, seed.title) : session.title,
    cwd: seed.cwd ?? session.cwd,
    rolloutPath: seed.rolloutPath ?? session.rolloutPath,
    startedAt: seed.startedAt ?? session.startedAt,
    updatedAt: seed.updatedAt ?? session.updatedAt,
    gitBranch: seed.gitBranch ?? session.gitBranch,
    tokensUsed: seed.tokensUsed ?? session.tokensUsed,
    seatId: seed.seatId ?? session.seatId,
  };
}

export class SessionStore {
  readonly #sessions = new Map<string, AgentSession>();
  readonly #events = new EventEmitter();
  readonly #offlineHistoryCap: number;

  constructor(options: SessionStoreOptions = {}) {
    this.#offlineHistoryCap = options.offlineHistoryCap ?? 200;
  }

  #emitDiscovered(created: AgentSession): void {
    this.emit({
      type: "session_discovered",
      sessionId: created.sessionId,
      timestamp: created.startedAt,
      state: created.state,
      currentTool: created.currentTool,
      activeSubtasks: created.activeSubtasks,
      details: null,
    });
  }

  #pruneOfflineHistory(): void {
    const offlineSessions = [...this.#sessions.values()]
      .filter((session) => session.state === "offline")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    for (const session of offlineSessions.slice(this.#offlineHistoryCap)) {
      this.#sessions.delete(session.sessionId);
    }
  }

  #setSession(session: AgentSession): void {
    this.#sessions.set(session.sessionId, session);
    this.#pruneOfflineHistory();
  }

  upsertSeed(seed: SessionSeedPatch): AgentSession {
    const current = this.#sessions.get(seed.sessionId);

    if (!current) {
      const createSeed: AgentSessionSeed = {
        sessionId: seed.sessionId,
        source: seed.source ?? "unknown",
        title: seed.title ?? seed.sessionId,
        cwd: seed.cwd ?? "",
        rolloutPath: seed.rolloutPath ?? "",
        startedAt: seed.startedAt ?? seed.updatedAt ?? new Date().toISOString(),
      };

      if (seed.updatedAt) {
        createSeed.updatedAt = seed.updatedAt;
      }

      if (seed.gitBranch !== undefined) {
        createSeed.gitBranch = seed.gitBranch;
      }

      if (seed.tokensUsed !== undefined) {
        createSeed.tokensUsed = seed.tokensUsed;
      }

      if (seed.seatId !== undefined) {
        createSeed.seatId = seed.seatId;
      }

      const created = createAgentSession({
        ...createSeed,
      });

      this.#setSession(created);
      this.#emitDiscovered(created);
      return created;
    }

    const merged = mergeSessionSeed(current, seed);
    this.#setSession(merged);
    return merged;
  }

  applyEntry(
    sessionId: string,
    entry: ParsedTranscriptEntry,
    seed: Omit<SessionSeedPatch, "sessionId"> = {},
  ): AgentSession {
    const session = this.upsertSeed({
      updatedAt: entry.timestamp,
      sessionId,
      ...seed,
    });
    const next = applyTranscriptEntry(session, entry);
    this.#setSession(next.session);

    for (const event of next.emitted) {
      this.emit(event);
    }

    return next.session;
  }

  list(): AgentSession[] {
    return [...this.#sessions.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  listLive(): AgentSession[] {
    return this.list().filter((session) => session.state !== "offline");
  }

  listOffline(): AgentSession[] {
    return this.list().filter((session) => session.state === "offline");
  }

  getQueryMeta(options: Pick<SessionQuery, "before" | "limit">): SessionQueryMeta {
    const liveSessions = this.listLive();
    const offlineSessions = this.listOffline();
    const before = options.before;
    const filteredOffline = before
      ? offlineSessions.filter((session) => session.updatedAt < before)
      : offlineSessions;
    const limit = options.limit ?? filteredOffline.length;
    const visibleOffline = filteredOffline.slice(0, limit);
    const hasMoreHistory = filteredOffline.length > visibleOffline.length;

    return {
      hasMoreHistory,
      historyCap: this.#offlineHistoryCap,
      liveCount: liveSessions.length,
      nextBefore: hasMoreHistory ? (visibleOffline.at(-1)?.updatedAt ?? null) : null,
      offlineCount: offlineSessions.length,
      trackedCount: this.#sessions.size,
    };
  }

  query(options: SessionQuery): SessionQueryResult {
    const liveSessions = this.listLive();
    const offlineSessions = this.listOffline();
    const before = options.before;
    const filteredOffline = before
      ? offlineSessions.filter((session) => session.updatedAt < before)
      : offlineSessions;
    const historyPage = filteredOffline.slice(0, options.limit);
    const metaOptions: Pick<SessionQuery, "before" | "limit"> = {};

    if (options.before !== undefined) {
      metaOptions.before = options.before;
    }

    if (options.limit !== undefined) {
      metaOptions.limit = options.limit;
    }

    const meta = this.getQueryMeta(metaOptions);

    switch (options.scope) {
      case "live":
        return {
          meta,
          sessions: liveSessions,
        };
      case "history":
        return {
          meta,
          sessions: historyPage,
        };
      case "all":
        return {
          meta,
          sessions: [...liveSessions, ...historyPage],
        };
    }
  }

  get(sessionId: string): AgentSession | undefined {
    return this.#sessions.get(sessionId);
  }

  markOffline(
    sessionId: string,
    timestamp: string = new Date().toISOString(),
    options: MarkOfflineOptions = {},
  ): void {
    const session = this.#sessions.get(sessionId);

    if (!session || session.state === "offline") {
      return;
    }

    const details = options.details ?? "idle_timeout";
    const next: AgentSession = {
      ...session,
      state: "offline",
      currentTool: null,
      updatedAt: options.preserveUpdatedAt ? session.updatedAt : timestamp,
      lastEventAt: timestamp,
      lastEventType: "session_exited",
    };

    this.#setSession(next);
    this.emit({
      type: "state_changed",
      sessionId,
      timestamp,
      state: next.state,
      currentTool: next.currentTool,
      activeSubtasks: next.activeSubtasks,
      details,
    });
    this.emit({
      type: "session_exited",
      sessionId,
      timestamp,
      state: next.state,
      currentTool: next.currentTool,
      activeSubtasks: next.activeSubtasks,
      details,
    });
    this.emit({
      type: "session_updated",
      sessionId,
      timestamp,
      state: next.state,
      currentTool: next.currentTool,
      activeSubtasks: next.activeSubtasks,
      details: null,
    });
  }

  markStaleSessionsOffline(now: number, idleMs: number): void {
    for (const session of this.#sessions.values()) {
      if (session.state === "offline") {
        continue;
      }

      const updatedAt = Date.parse(session.updatedAt);

      if (Number.isFinite(updatedAt) && now - updatedAt >= idleMs) {
        this.markOffline(session.sessionId, new Date(now).toISOString());
      }
    }
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#events.on("event", listener);
    return () => {
      this.#events.off("event", listener);
    };
  }

  emit(event: AgentEvent): void {
    this.#events.emit("event", event);
  }
}
