import { describe, expect, it } from "vitest";

import { defaultOfficeLayout } from "@office-codex/assets";
import { createAgentSession } from "@office-codex/core";
import type { AgentSession } from "@office-codex/core";

import {
  BLOCKED_WAIT_MS,
  RECENTLY_FINISHED_MS,
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

function buildAttentionItems(
  sessions: AgentSession[],
  now: number,
  activityBySession: Parameters<typeof getAttentionItems>[1] = {},
) {
  const assignments = Object.fromEntries(
    sessions.map((session, index) => [session.sessionId, defaultOfficeLayout.desks[index]?.id ?? "desk-01"]),
  );

  return getAttentionItems(
    buildLiveOfficeSessions(sessions, defaultOfficeLayout, assignments, now),
    activityBySession,
    now,
  );
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
      updatedAt: "2026-03-09T09:05:30.000Z",
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

  it("surfaces action-now items with human reasons and blocked waits ahead of fresh waits", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const permissionNeeded = createSession("permission", {
      pendingApprovalJustification: "Do you want to allow the daemon to start?",
      state: "permission_needed",
      updatedAt: "2026-03-09T09:09:58.000Z",
    });
    const blockedWaiting = createSession("blocked-waiting", {
      lastUserQuestion: "Which repo scope should I use?",
      state: "waiting_user",
      updatedAt: new Date(now - BLOCKED_WAIT_MS - 1_000).toISOString(),
    });
    const freshWaiting = createSession("fresh-waiting", {
      lastUserQuestion: "Should I run tests?",
      state: "waiting_user",
      updatedAt: new Date(now - 30_000).toISOString(),
    });

    const items = buildAttentionItems([permissionNeeded, blockedWaiting, freshWaiting], now);

    expect(items.map((item) => item.kind)).toEqual([
      "needs_approval",
      "needs_answer",
      "needs_answer",
    ]);
    expect(items.map((item) => item.section)).toEqual([
      "action_now",
      "action_now",
      "action_now",
    ]);
    expect(items[1]).toMatchObject({
      detail: "Which repo scope should I use?",
      headline: "Needs answer",
      severity: "critical",
    });
    expect(items[2]).toMatchObject({
      detail: "Should I run tests?",
      headline: "Needs answer",
      severity: "warning",
    });
  });

  it("uses the latest relevant error detail for attention items", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const errored = createSession("errored", {
      state: "error",
      updatedAt: "2026-03-09T09:09:58.000Z",
    });
    const items = buildAttentionItems([errored], now, {
      [errored.sessionId]: [
        {
          id: "errored:1",
          label: "State -> error",
          state: "error",
          timestamp: "2026-03-09T09:09:58.000Z",
          tool: null,
          type: "state_changed",
        },
        {
          id: "errored:2",
          label: "Failed while editing Header.tsx",
          state: "error",
          timestamp: "2026-03-09T09:09:57.000Z",
          tool: null,
          type: "session_updated",
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        detail: "Failed while editing Header.tsx",
        headline: "Needs attention",
        kind: "error",
        section: "action_now",
        severity: "critical",
      }),
    ]);
  });

  it("treats permission_needed as approval-needed attention", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const permissionNeeded = createSession("permission", {
      pendingApprovalJustification: "Do you want to allow the daemon to start?",
      state: "permission_needed",
      updatedAt: "2026-03-09T09:09:58.000Z",
    });
    const items = buildAttentionItems([permissionNeeded], now);

    expect(items).toEqual([
      expect.objectContaining({
        detail: "Do you want to allow the daemon to start?",
        headline: "Needs approval",
        kind: "needs_approval",
        section: "action_now",
        severity: "critical",
      }),
    ]);
  });

  it("puts stalled active work into watch closely", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const stuck = createSession("stuck", {
      currentTool: "rg",
      state: "using_tool",
      updatedAt: new Date(now - BLOCKED_WAIT_MS - 10_000).toISOString(),
    });
    const items = buildAttentionItems([stuck], now);

    expect(items).toEqual([
      expect.objectContaining({
        detail: "Using rg",
        headline: "No progress in 4m",
        kind: "stuck",
        section: "watch_closely",
        severity: "warning",
      }),
    ]);
  });

  it("shows waiting sessions with recorded answers in watch closely", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const waiting = createSession("waiting", {
      lastUserAnswer: "Minimal change",
      lastUserQuestion: "Approach: Which implementation path should I use?",
      state: "waiting_user",
      updatedAt: new Date(now - 30_000).toISOString(),
    });
    const items = buildAttentionItems([waiting], now);

    expect(items).toEqual([
      expect.objectContaining({
        detail: "Approach: Which implementation path should I use?",
        headline: "Response recorded",
        kind: "response_recorded",
        section: "watch_closely",
        severity: "info",
      }),
    ]);
  });

  it("shows recently finished work only within the active time window", () => {
    const now = Date.parse("2026-03-09T09:10:00.000Z");
    const freshFinished = createSession("fresh-finished", {
      lastTurnOutcome: "completed",
      lastTurnOutcomeAt: new Date(now - RECENTLY_FINISHED_MS + 30_000).toISOString(),
      state: "inactive",
      updatedAt: new Date(now - 30_000).toISOString(),
    });
    const staleFinished = createSession("stale-finished", {
      lastTurnOutcome: "completed",
      lastTurnOutcomeAt: new Date(now - RECENTLY_FINISHED_MS - 30_000).toISOString(),
      state: "inactive",
      updatedAt: new Date(now - 30_000).toISOString(),
    });

    const items = buildAttentionItems([freshFinished, staleFinished], now);

    expect(items).toEqual([
      expect.objectContaining({
        detail: "Finished 2m ago",
        headline: "Finished",
        kind: "finished",
        section: "recently_finished",
        severity: "info",
      }),
    ]);
  });
});
