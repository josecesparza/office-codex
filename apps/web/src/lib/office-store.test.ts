import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentSession } from "@office-codex/core";
import type { AgentEvent, AgentSession } from "@office-codex/core";

import { DEFAULT_OFFICE_UI_SETTINGS } from "./office-settings";
import { type EventEnvelope, useOfficeStore } from "./office-store";

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

function createEnvelope(session: AgentSession, type: AgentEvent["type"]): EventEnvelope {
  return {
    event: {
      activeSubtasks: session.activeSubtasks,
      currentTool: session.currentTool,
      details: null,
      sessionId: session.sessionId,
      state: session.state,
      timestamp: session.updatedAt,
      type,
    },
    session,
  };
}

beforeEach(() => {
  useOfficeStore.setState({
    account: null,
    activityBySession: {},
    connection: "connecting",
    historySessions: [],
    lastMutationAt: 0,
    layout: null,
    liveSessions: [],
    settings: DEFAULT_OFFICE_UI_SETTINGS,
    sessionMeta: null,
    sessions: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("office-store", () => {
  it("stores live snapshots separately from offline history", () => {
    const live = createSession("live", {
      state: "thinking",
      updatedAt: "2026-03-09T10:00:00.000Z",
    });
    const offline = createSession("offline", {
      state: "offline",
      updatedAt: "2026-03-09T09:55:00.000Z",
    });

    useOfficeStore.getState().setLiveSnapshot([live, offline], {
      hasMoreHistory: true,
      historyCap: 200,
      liveCount: 1,
      nextBefore: "2026-03-09T09:35:00.000Z",
      offlineCount: 12,
      trackedCount: 13,
    });

    const state = useOfficeStore.getState();

    expect(state.liveSessions).toEqual([live]);
    expect(state.historySessions).toEqual([]);
    expect(state.sessions).toEqual([live]);
    expect(state.sessionMeta).toEqual(
      expect.objectContaining({
        liveCount: 1,
        offlineCount: 12,
        trackedCount: 13,
      }),
    );
  });

  it("replaces and appends offline history pages without duplicating sessions", () => {
    const pageOne = [
      createSession("offline-a", {
        state: "offline",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
      createSession("offline-b", {
        state: "offline",
        updatedAt: "2026-03-09T09:58:00.000Z",
      }),
    ];
    const pageTwo = [
      createSession("offline-b", {
        state: "offline",
        updatedAt: "2026-03-09T09:58:00.000Z",
      }),
      createSession("offline-c", {
        state: "offline",
        updatedAt: "2026-03-09T09:56:00.000Z",
      }),
    ];

    useOfficeStore.getState().setHistoryPage(
      pageOne,
      {
        hasMoreHistory: true,
        historyCap: 200,
        liveCount: 0,
        nextBefore: "2026-03-09T09:58:00.000Z",
        offlineCount: 3,
        trackedCount: 3,
      },
      "replace",
    );
    useOfficeStore.getState().setHistoryPage(
      pageTwo,
      {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 0,
        nextBefore: null,
        offlineCount: 3,
        trackedCount: 3,
      },
      "append",
    );

    const state = useOfficeStore.getState();

    expect(state.historySessions.map((session) => session.sessionId)).toEqual([
      "offline-a",
      "offline-b",
      "offline-c",
    ]);
    expect(state.sessionMeta).toEqual(
      expect.objectContaining({
        hasMoreHistory: false,
        offlineCount: 3,
      }),
    );
  });

  it("moves a live session into offline history when the daemon emits an offline update", () => {
    const live = createSession("alpha", {
      state: "waiting_user",
      updatedAt: "2026-03-09T10:00:00.000Z",
    });

    useOfficeStore.getState().setLiveSnapshot([live], {
      hasMoreHistory: false,
      historyCap: 200,
      liveCount: 1,
      nextBefore: null,
      offlineCount: 0,
      trackedCount: 1,
    });

    const offline = {
      ...live,
      state: "offline" as const,
      updatedAt: "2026-03-09T10:05:00.000Z",
    };

    useOfficeStore.getState().applyEnvelope(createEnvelope(offline, "session_exited"));

    const state = useOfficeStore.getState();

    expect(state.liveSessions).toEqual([]);
    expect(state.historySessions).toEqual([offline]);
    expect(state.sessionMeta).toEqual(
      expect.objectContaining({
        liveCount: 0,
        offlineCount: 1,
        trackedCount: 1,
      }),
    );
  });

  it("removes a recovered session from offline history when it becomes live again", () => {
    const offline = createSession("beta", {
      state: "offline",
      updatedAt: "2026-03-09T09:50:00.000Z",
    });

    useOfficeStore.getState().setHistoryPage(
      [offline],
      {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 0,
        nextBefore: null,
        offlineCount: 1,
        trackedCount: 1,
      },
      "replace",
    );

    const live = {
      ...offline,
      state: "thinking" as const,
      updatedAt: "2026-03-09T10:06:00.000Z",
    };

    useOfficeStore.getState().applyEnvelope(createEnvelope(live, "state_changed"));

    const state = useOfficeStore.getState();

    expect(state.liveSessions).toEqual([live]);
    expect(state.historySessions).toEqual([]);
    expect(state.sessionMeta).toEqual(
      expect.objectContaining({
        liveCount: 1,
        offlineCount: 0,
        trackedCount: 1,
      }),
    );
  });

  it("hydrates, updates and resets persisted ui settings", () => {
    const localStorageMock = {
      getItem() {
        return JSON.stringify({
          compactMode: true,
          historyPageSize: 50,
          liveRosterLimit: 12,
          reducedMotion: true,
          showAttentionInbox: false,
          showOfflineHistoryByDefault: true,
          showOfficeTooltips: false,
          tooltipDetailLevel: "minimal",
        });
      },
      setItem: vi.fn(),
    };

    vi.stubGlobal("localStorage", localStorageMock);

    useOfficeStore.getState().hydrateSettings();
    expect(useOfficeStore.getState().settings).toEqual({
      compactMode: true,
      historyPageSize: 50,
      liveRosterLimit: 12,
      reducedMotion: true,
      showAttentionInbox: false,
      showOfflineHistoryByDefault: true,
      showOfficeTooltips: false,
      tooltipDetailLevel: "minimal",
    });

    useOfficeStore.getState().updateSettings({
      compactMode: false,
      liveRosterLimit: 40,
      showAttentionInbox: true,
      showOfficeTooltips: true,
      tooltipDetailLevel: "full",
    });
    expect(useOfficeStore.getState().settings).toEqual({
      compactMode: false,
      historyPageSize: 50,
      liveRosterLimit: 40,
      reducedMotion: true,
      showAttentionInbox: true,
      showOfflineHistoryByDefault: true,
      showOfficeTooltips: true,
      tooltipDetailLevel: "full",
    });

    useOfficeStore.getState().resetSettings();
    expect(useOfficeStore.getState().settings).toEqual(DEFAULT_OFFICE_UI_SETTINGS);
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });
});
