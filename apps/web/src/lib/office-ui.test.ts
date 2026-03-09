import { describe, expect, it } from "vitest";

import { defaultOfficeLayout } from "@office-codex/assets";
import { createAgentSession } from "@office-codex/core";
import type { AgentSession } from "@office-codex/core";

import {
  BLOCKED_WAIT_MS,
  buildLiveOfficeSessions,
  createDeskBadgeMap,
  getAttentionItems,
  getHeatmapIntensity,
  isBlockedSession,
  reconcileDeskAssignments,
} from "./office-ui";

function createSession(sessionId: string, options: Partial<AgentSession> = {}): AgentSession {
  return {
    ...createAgentSession({
      cwd: `/tmp/${sessionId}`,
      rolloutPath: `/tmp/${sessionId}.jsonl`,
      sessionId,
      source: "test",
      startedAt: "2026-03-09T09:00:00.000Z",
      title: sessionId,
      updatedAt: "2026-03-09T09:00:00.000Z",
    }),
    ...options,
  };
}

describe("office-ui", () => {
  it("creates desk badges in row-major order", () => {
    const badges = createDeskBadgeMap(defaultOfficeLayout);

    expect(badges.get("desk-01")).toBe("A1");
    expect(badges.get("desk-04")).toBe("A4");
    expect(badges.get("desk-05")).toBe("B1");
    expect(badges.get("desk-12")).toBe("C4");
  });

  it("preserves prior desk assignments when session order changes", () => {
    const sessionAlpha = createSession("alpha");
    const sessionBeta = createSession("beta");
    const firstAssignments = reconcileDeskAssignments(
      {},
      [sessionAlpha, sessionBeta],
      defaultOfficeLayout,
    );

    const secondAssignments = reconcileDeskAssignments(
      firstAssignments,
      [sessionBeta, sessionAlpha],
      defaultOfficeLayout,
    );

    expect(firstAssignments).toEqual({
      alpha: "desk-01",
      beta: "desk-02",
    });
    expect(secondAssignments).toEqual(firstAssignments);
  });

  it("sorts live office sessions by desk and flags blocked waiting agents", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const recent = createSession("recent", {
      state: "thinking",
      updatedAt: "2026-03-09T09:09:45.000Z",
    });
    const blocked = createSession("blocked", {
      state: "waiting_user",
      updatedAt: "2026-03-09T09:06:30.000Z",
    });

    const assignments = {
      blocked: "desk-02",
      recent: "desk-01",
    };
    const renderSessions = buildLiveOfficeSessions(
      [blocked, recent],
      defaultOfficeLayout,
      assignments,
      now,
    );

    expect(renderSessions.map((session) => session.session.sessionId)).toEqual([
      "recent",
      "blocked",
    ]);
    expect(renderSessions.map((session) => session.deskBadge)).toEqual(["A1", "A2"]);
    expect(renderSessions[1]?.isBlocked).toBe(true);
  });

  it("calculates blocked waiting states and heatmap decay from updatedAt", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const blocked = createSession("blocked", {
      state: "waiting_user",
      updatedAt: new Date(now - BLOCKED_WAIT_MS - 1_000).toISOString(),
    });
    const fresh = createSession("fresh", {
      state: "waiting_user",
      updatedAt: new Date(now - 20_000).toISOString(),
    });

    expect(isBlockedSession(blocked, now)).toBe(true);
    expect(isBlockedSession(fresh, now)).toBe(false);
    expect(getHeatmapIntensity(fresh, now)).toBeGreaterThan(getHeatmapIntensity(blocked, now));
  });

  it("surfaces attention items with critical errors first", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const errored = createSession("errored", {
      state: "error",
      updatedAt: "2026-03-09T09:09:50.000Z",
    });
    const waiting = createSession("waiting", {
      state: "waiting_user",
      updatedAt: new Date(now - BLOCKED_WAIT_MS - 1_000).toISOString(),
    });
    const renderSessions = buildLiveOfficeSessions(
      [waiting, errored],
      defaultOfficeLayout,
      {
        errored: "desk-01",
        waiting: "desk-02",
      },
      now,
    );

    expect(getAttentionItems(renderSessions, now)).toEqual([
      expect.objectContaining({
        reason: "Agent error",
        severity: "critical",
      }),
      expect.objectContaining({
        severity: "warning",
      }),
    ]);
  });

  it("includes fresh waiting sessions as awaiting response", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const waiting = createSession("waiting", {
      state: "waiting_user",
      updatedAt: new Date(now - 30_000).toISOString(),
    });
    const renderSessions = buildLiveOfficeSessions(
      [waiting],
      defaultOfficeLayout,
      {
        waiting: "desk-01",
      },
      now,
    );

    expect(getAttentionItems(renderSessions, now)).toEqual([
      expect.objectContaining({
        reason: "Awaiting response",
        severity: "warning",
      }),
    ]);
  });
});
