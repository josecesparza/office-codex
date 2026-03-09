import { EventEmitter } from "node:events";

import {
  type AgentEvent,
  type AgentSession,
  applyTranscriptEntry,
  createAgentSession,
} from "@office-codex/core";
import type { AgentSessionSeed, ParsedTranscriptEntry } from "@office-codex/core";

export interface SessionSeedPatch {
  sessionId: string;
  source?: string;
  title?: string;
  cwd?: string;
  rolloutPath?: string;
  startedAt?: string;
  updatedAt?: string;
  gitBranch?: string | null;
  seatId?: string | null;
}

function mergeSessionSeed(session: AgentSession, seed: SessionSeedPatch): AgentSession {
  return {
    ...session,
    source: seed.source ?? session.source,
    title: seed.title ?? session.title,
    cwd: seed.cwd ?? session.cwd,
    rolloutPath: seed.rolloutPath ?? session.rolloutPath,
    startedAt: seed.startedAt ?? session.startedAt,
    updatedAt: seed.updatedAt ?? session.updatedAt,
    gitBranch: seed.gitBranch ?? session.gitBranch,
    seatId: seed.seatId ?? session.seatId,
  };
}

export class SessionStore {
  readonly #sessions = new Map<string, AgentSession>();
  readonly #events = new EventEmitter();

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

      if (seed.seatId !== undefined) {
        createSeed.seatId = seed.seatId;
      }

      const created = createAgentSession({
        ...createSeed,
      });

      this.#sessions.set(seed.sessionId, created);
      this.emit({
        type: "session_discovered",
        sessionId: created.sessionId,
        timestamp: created.startedAt,
        state: created.state,
        currentTool: created.currentTool,
        activeSubtasks: created.activeSubtasks,
        details: null,
      });
      return created;
    }

    const merged = mergeSessionSeed(current, seed);
    this.#sessions.set(seed.sessionId, merged);
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
    this.#sessions.set(sessionId, next.session);

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

  get(sessionId: string): AgentSession | undefined {
    return this.#sessions.get(sessionId);
  }

  markOffline(sessionId: string, timestamp: string = new Date().toISOString()): void {
    const session = this.#sessions.get(sessionId);

    if (!session || session.state === "offline") {
      return;
    }

    const next: AgentSession = {
      ...session,
      state: "offline",
      currentTool: null,
      updatedAt: timestamp,
      lastEventAt: timestamp,
      lastEventType: "session_exited",
    };

    this.#sessions.set(sessionId, next);
    this.emit({
      type: "state_changed",
      sessionId,
      timestamp,
      state: next.state,
      currentTool: next.currentTool,
      activeSubtasks: next.activeSubtasks,
      details: "idle_timeout",
    });
    this.emit({
      type: "session_exited",
      sessionId,
      timestamp,
      state: next.state,
      currentTool: next.currentTool,
      activeSubtasks: next.activeSubtasks,
      details: "idle_timeout",
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
