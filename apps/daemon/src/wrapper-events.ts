import type { WrapperEvent } from "@office-codex/core";

import type { SessionStore } from "./session-store.js";

interface WrapperHintRecord {
  argv: string[];
  cwd: string;
  expiresAt: number;
  pid: number;
  sessionId: string | null;
  startedAt: string;
}

export interface WrapperEventHandlerDiagnostics {
  activeHints: number;
  ttlMs: number;
}

export class WrapperEventHandler {
  readonly #store: SessionStore;
  readonly #ttlMs: number;
  readonly #hintsByPid = new Map<number, WrapperHintRecord>();

  constructor(store: SessionStore, ttlMs: number) {
    this.#store = store;
    this.#ttlMs = ttlMs;
  }

  #purgeExpired(now = Date.now()): void {
    for (const [pid, hint] of this.#hintsByPid.entries()) {
      if (hint.expiresAt <= now) {
        this.#hintsByPid.delete(pid);
      }
    }
  }

  apply(event: WrapperEvent): void {
    const now = Date.now();
    this.#purgeExpired(now);

    switch (event.type) {
      case "launch":
        this.#hintsByPid.set(event.pid, {
          argv: event.argv,
          cwd: event.cwd,
          expiresAt: now + this.#ttlMs,
          pid: event.pid,
          sessionId: null,
          startedAt: event.startedAt,
        });
        return;

      case "identified": {
        this.#hintsByPid.set(event.pid, {
          argv: event.argv,
          cwd: event.cwd,
          expiresAt: now + this.#ttlMs,
          pid: event.pid,
          sessionId: event.sessionId,
          startedAt: event.startedAt,
        });
        this.#store.upsertSeed({
          sessionId: event.sessionId,
          cwd: event.cwd,
          source: "wrapper",
          startedAt: event.startedAt,
          updatedAt: event.startedAt,
        });
        return;
      }

      case "exit": {
        const existing = this.#hintsByPid.get(event.pid);
        const sessionId = event.sessionId ?? existing?.sessionId ?? null;

        if (sessionId) {
          this.#store.markOffline(sessionId, event.exitedAt);
        }

        this.#hintsByPid.delete(event.pid);
        return;
      }
    }
  }

  getDiagnostics(): WrapperEventHandlerDiagnostics {
    this.#purgeExpired();
    return {
      activeHints: this.#hintsByPid.size,
      ttlMs: this.#ttlMs,
    };
  }
}
