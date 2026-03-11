// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultOfficeLayout } from "@office-codex/assets";
import { createAgentSession } from "@office-codex/core";
import type { AgentSession } from "@office-codex/core";

import { App } from "./app";
import { DEFAULT_OFFICE_UI_SETTINGS } from "./lib/office-settings";
import type { SessionActivityItem } from "./lib/office-store";
import { useOfficeStore } from "./lib/office-store";

const loadMoreHistory = vi.fn<() => Promise<void>>(() => Promise.resolve());

vi.mock("./lib/use-office-data", () => ({
  useOfficeData: () => ({
    historyLoaded: true,
    historyLoading: false,
    loadMoreHistory,
  }),
}));

vi.mock("./components/office-canvas", () => ({
  OfficeCanvas: (props: {
    onHoveredSessionChange?: (sessionId: string | null) => void;
    onSessionGeometryChange?: (geometry: Record<string, unknown>) => void;
    reducedMotion?: boolean;
    sessions: Array<{ session: AgentSession }>;
  }) => {
    React.useEffect(() => {
      const firstSession = props.sessions[0];

      if (!firstSession || !props.onSessionGeometryChange) {
        return;
      }

      props.onSessionGeometryChange({
        [firstSession.session.sessionId]: {
          agentBounds: {
            height: 24,
            width: 18,
            x: 24,
            y: 12,
          },
          agentCenter: {
            x: 33,
            y: 24,
          },
          deskBounds: {
            height: 16,
            width: 26,
            x: 22,
            y: 28,
          },
          deskCenter: {
            x: 35,
            y: 36,
          },
        },
      });
    }, [props.onSessionGeometryChange, props.sessions]);

    return (
      <button
        data-reduced-motion={String(Boolean(props.reducedMotion))}
        data-testid="office-canvas"
        onMouseEnter={() =>
          props.onHoveredSessionChange?.(props.sessions[0]?.session.sessionId ?? null)
        }
        onMouseLeave={() => props.onHoveredSessionChange?.(null)}
        type="button"
      >
        Mock office canvas
      </button>
    );
  },
}));

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

function createStorage() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function buildLiveSessions(count: number): AgentSession[] {
  return Array.from({ length: count }, (_, index) =>
    createSession(`live-${index + 1}`, {
      cwd: `/tmp/live-${index + 1}`,
      gitBranch: `branch-${index + 1}`,
      state: "thinking",
      title: `Live session ${index + 1}`,
      updatedAt: `2026-03-09T09:${String(index).padStart(2, "0")}:00.000Z`,
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorage());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({
    addEventListener() {},
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    removeEventListener() {},
  }));
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  loadMoreHistory.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("app settings", () => {
  it("opens the settings sheet and applies offline history visibility immediately", async () => {
    const user = userEvent.setup();

    useOfficeStore.setState({
      account: {
        status: "unavailable",
      },
      activityBySession: {},
      connection: "ready",
      historySessions: [
        createSession("offline-1", {
          state: "offline",
          title: "Offline session",
          updatedAt: "2026-03-09T09:20:00.000Z",
        }),
      ],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [createSession("live-1", { title: "Live session" })],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 1,
        nextBefore: null,
        offlineCount: 1,
        trackedCount: 2,
      },
      sessions: [],
    });

    render(<App />);

    expect(screen.queryByText("Offline session")).toBeNull();
    expect(screen.queryByText("Usage unavailable")).toBeNull();

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText("Connection")).toBeTruthy();
    expect(within(dialog).getByText("Ready")).toBeTruthy();
    expect(within(dialog).getByText("Usage")).toBeTruthy();
    expect(within(dialog).getByText("Usage unavailable")).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: /show offline history by default/i }));
    expect(screen.getByText("Offline session")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates live roster limit, history page size, tooltip visibility and reduced motion", async () => {
    const user = userEvent.setup();
    const liveSessions = buildLiveSessions(15);
    const attentionSessionIndex = liveSessions.length - 1;
    const attentionSession = liveSessions[attentionSessionIndex];

    if (!attentionSession) {
      throw new Error("Expected at least one live session");
    }

    liveSessions[attentionSessionIndex] = {
      ...attentionSession,
      lastUserQuestion: "Need approval for the rollout path",
      state: "waiting_user",
      updatedAt: "2026-03-09T09:20:00.000Z",
    };

    useOfficeStore.setState({
      account: null,
      activityBySession: {},
      connection: "ready",
      historySessions: [
        createSession("offline-1", {
          state: "offline",
          title: "Offline session",
          updatedAt: "2026-03-09T09:20:00.000Z",
        }),
      ],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions,
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: true,
        historyCap: 200,
        liveCount: liveSessions.length,
        nextBefore: "2026-03-09T09:20:00.000Z",
        offlineCount: 25,
        trackedCount: 40,
      },
      sessions: [],
    });

    const { container } = render(<App />);

    expect(container.querySelectorAll(".session-card-live")).toHaveLength(15);

    await user.click(screen.getByRole("button", { name: /open settings/i }));

    await user.click(screen.getByRole("combobox", { name: /live roster limit/i }));
    await user.click(screen.getByText("12 live cards"));
    expect(container.querySelectorAll(".session-card-live")).toHaveLength(12);
    expect(container.firstElementChild?.getAttribute("data-compact-mode")).toBe("false");

    await user.click(screen.getByRole("switch", { name: /compact roster mode/i }));
    expect(container.firstElementChild?.getAttribute("data-compact-mode")).toBe("true");

    expect(screen.getByText("Watch closely")).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: /show attention inbox/i }));
    expect(screen.queryByText("Watch closely")).toBeNull();

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    await user.hover(screen.getByTestId("office-canvas"));
    expect(screen.getByTestId("office-tooltip")).toBeTruthy();
    expect(screen.getByTestId("office-tooltip").textContent).toContain("Branch");
    expect(screen.getByTestId("office-tooltip").textContent).toContain("Tool");

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByRole("combobox", { name: /tooltip detail level/i })).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: /tooltip detail level/i }));
    await user.click(screen.getByText("Minimal tooltip"));

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    await user.hover(screen.getByTestId("office-canvas"));
    expect(screen.getByTestId("office-tooltip").textContent).not.toContain("Branch");
    expect(screen.getByTestId("office-tooltip").textContent).not.toContain("Tool");

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("switch", { name: /show office tooltips/i }));
    expect(screen.queryByRole("combobox", { name: /tooltip detail level/i })).toBeNull();
    expect(container.querySelector(".office-tooltip")).toBeNull();

    await user.click(screen.getByRole("switch", { name: /reduced motion/i }));
    expect(screen.getByTestId("office-canvas").getAttribute("data-reduced-motion")).toBe("true");

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    await user.click(screen.getByRole("button", { name: /show history/i }));
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    loadMoreHistory.mockClear();

    await user.click(screen.getByRole("combobox", { name: /offline history page size/i }));
    await user.click(screen.getByText("50 history cards"));

    expect(loadMoreHistory).toHaveBeenCalledWith({
      limit: 50,
      reset: true,
    });
  });

  it("shows response-recorded sessions in the watch closely attention section", () => {
    const updatedAt = new Date(Date.now() - 30_000).toISOString();

    useOfficeStore.setState({
      account: null,
      activityBySession: {},
      connection: "ready",
      historySessions: [],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [
        createSession("waiting-1", {
          lastUserAnswer: "Minimal change",
          lastUserQuestion: "Approach: Which implementation path should I use?",
          state: "waiting_user",
          title: "Waiting session",
          updatedAt,
        }),
      ],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 1,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 1,
      },
      sessions: [],
    });

    render(<App />);

    expect(screen.queryByText("Needs action now")).toBeNull();
    expect(screen.getByText("Watch closely")).toBeTruthy();
    expect(screen.getByText("Approach: Which implementation path should I use?")).toBeTruthy();
    expect(screen.getByText("Response recorded")).toBeTruthy();
    expect(screen.queryByText("Minimal change")).toBeNull();
  });

  it("renders attention sections in order before live sessions and opens the selected drawer", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const permissionSession = createSession("permission-1", {
      pendingApprovalJustification: "Do you want to allow the daemon to start?",
      state: "permission_needed",
      title: "Permission session",
      updatedAt: new Date(now - 45_000).toISOString(),
    });
    const stuckSession = createSession("stuck-1", {
      currentTool: "rg",
      state: "using_tool",
      title: "Stuck session",
      updatedAt: new Date(now - 300_000).toISOString(),
    });
    const finishedSession = createSession("finished-1", {
      lastTurnOutcome: "completed",
      lastTurnOutcomeAt: new Date(now - 120_000).toISOString(),
      state: "inactive",
      title: "Finished session",
      updatedAt: new Date(now - 120_000).toISOString(),
    });

    useOfficeStore.setState({
      account: null,
      activityBySession: {},
      connection: "ready",
      historySessions: [],
      lastMutationAt: now,
      layout: defaultOfficeLayout,
      liveSessions: [permissionSession, stuckSession, finishedSession],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 3,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 3,
      },
      sessions: [],
    });

    render(<App />);

    const panelHeadings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);

    expect(panelHeadings.slice(0, 4)).toEqual([
      "Needs action now",
      "Watch closely",
      "Recently finished",
      "Live sessions",
    ]);

    const actionSection = screen.getByText("Needs action now").closest("section");

    if (!actionSection) {
      throw new Error("Expected attention action section");
    }

    await user.click(within(actionSection).getByRole("button", { name: /permission session/i }));
    expect(screen.getByText("Do you want to allow the daemon to start?")).toBeTruthy();
  });

  it("shows an empty attention state above the live roster when nothing needs attention", () => {
    const updatedAt = new Date(Date.now() - 30_000).toISOString();

    useOfficeStore.setState({
      account: null,
      activityBySession: {},
      connection: "ready",
      historySessions: [],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [
        createSession("thinking-1", {
          state: "thinking",
          title: "Thinking session",
          updatedAt,
        }),
      ],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 1,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 1,
      },
      sessions: [],
    });

    render(<App />);

    expect(screen.getByText("Nothing needs attention right now.")).toBeTruthy();
    expect(screen.getByText("Live sessions")).toBeTruthy();
    expect(screen.getByRole("button", { name: /thinking session/i })).toBeTruthy();
  });
});

describe("app drawer", () => {
  it("shows a waiting card with collapsible proposed answers for selected sessions", async () => {
    const user = userEvent.setup();
    const updatedAt = new Date(Date.now() - 30_000).toISOString();
    const waitingSession = createSession("waiting-1", {
      activeSubtasks: 2,
      cwd: "/tmp/monorepo",
      gitBranch: "codex/fix-drawer",
      lastUserQuestion: "Approach: Which implementation path should I use?",
      lastUserOptions: [
        {
          description: "Patch only the affected drawer flow.",
          id: "minimal_change",
          label: "Minimal change",
        },
        {
          description: "Restructure the selected-session drawer before iterating.",
          id: "full_refactor",
          label: "Full refactor",
        },
      ],
      state: "waiting_user",
      title: "Waiting session",
      tokensUsed: 1_250_000,
      updatedAt,
    });
    const activity: SessionActivityItem[] = [
      {
        id: "waiting-1:tool_started:1",
        label: "Started rg",
        state: "using_tool",
        timestamp: updatedAt,
        tool: "rg",
        type: "tool_started",
      },
    ];

    useOfficeStore.setState({
      account: null,
      activityBySession: {
        [waitingSession.sessionId]: activity,
      },
      connection: "ready",
      historySessions: [],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [waitingSession],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 1,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 1,
      },
      sessions: [],
    });

    render(<App />);

    const liveSessionsSection = screen.getByText("Live sessions").closest("section");

    if (!liveSessionsSection) {
      throw new Error("Expected live sessions section");
    }

    await user.click(within(liveSessionsSection).getByRole("button", { name: /waiting session/i }));

    expect(screen.getByText("Codex question")).toBeTruthy();
    expect(screen.getByText("Approach: Which implementation path should I use?")).toBeTruthy();
    expect(screen.getByText("Suggested responses")).toBeTruthy();
    expect(screen.getByText("Minimal change")).toBeTruthy();
    expect(screen.getByText("Full refactor")).toBeTruthy();
    expect(screen.getByText("You can answer differently in freeform.")).toBeTruthy();
    expect(screen.queryByText("Repo")).toBeNull();
    expect(screen.getByText("Recent activity")).toBeTruthy();
    expect(screen.getByText("Started rg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /hide proposed answers/i })).toBeTruthy();
    expect(screen.queryByText("Tokens used")).toBeNull();
    expect(screen.queryByText("Signal source")).toBeNull();

    await user.click(screen.getByRole("button", { name: /hide proposed answers/i }));

    expect(screen.getByText("Approach: Which implementation path should I use?")).toBeTruthy();
    expect(screen.queryByText("Minimal change")).toBeNull();
    expect(screen.queryByText("Full refactor")).toBeNull();
    expect(screen.queryByText("You can answer differently in freeform.")).toBeNull();

    await user.click(screen.getByRole("button", { name: /show proposed answers/i }));

    expect(screen.getByText("Minimal change")).toBeTruthy();
    expect(screen.getByText("Full refactor")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /close selected session/i }));
    expect(screen.getByText("Session overview")).toBeTruthy();
  });

  it("shows waiting answer descriptions in tooltips and falls back to a question-only card", async () => {
    const user = userEvent.setup();
    const updatedAt = new Date(Date.now() - 30_000).toISOString();
    const waitingWithOptions = createSession("waiting-1", {
      lastUserQuestion: "Approach: Which implementation path should I use?",
      lastUserOptions: [
        {
          description: "Patch only the affected drawer flow.",
          id: "minimal_change",
          label: "Minimal change",
        },
      ],
      state: "waiting_user",
      title: "Waiting with options",
      updatedAt,
    });
    const waitingWithoutOptions = createSession("waiting-2", {
      lastUserQuestion: "Which repo scope should I use?",
      lastUserOptions: [],
      state: "waiting_user",
      title: "Waiting without options",
      updatedAt,
    });

    useOfficeStore.setState({
      account: null,
      activityBySession: {},
      connection: "ready",
      historySessions: [],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [waitingWithOptions, waitingWithoutOptions],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 2,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 2,
      },
      sessions: [],
    });

    render(<App />);

    const liveSessionsSection = screen.getByText("Live sessions").closest("section");

    if (!liveSessionsSection) {
      throw new Error("Expected live sessions section");
    }

    await user.click(
      within(liveSessionsSection).getByRole("button", { name: /waiting with options/i }),
    );

    const detailsButton = screen.getByRole("button", { name: /details for minimal change/i });
    await user.hover(detailsButton);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Patch only the affected drawer flow.",
    );
    await user.unhover(detailsButton);

    await user.click(screen.getByRole("button", { name: /close selected session/i }));

    const refreshedLiveSessionsSection = screen.getByText("Live sessions").closest("section");

    if (!refreshedLiveSessionsSection) {
      throw new Error("Expected live sessions section");
    }

    await user.click(
      within(refreshedLiveSessionsSection).getByRole("button", {
        name: /waiting without options/i,
      }),
    );

    expect(screen.getByText("Which repo scope should I use?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /show proposed answers/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hide proposed answers/i })).toBeNull();
    expect(screen.queryByText("Suggested responses")).toBeNull();
  });

  it("keeps compact summary data and collapsed diagnostics for non-waiting sessions", async () => {
    const user = userEvent.setup();
    const updatedAt = new Date(Date.now() - 30_000).toISOString();
    const liveSession = createSession("thinking-1", {
      activeSubtasks: 2,
      cwd: "/tmp/monorepo",
      gitBranch: "codex/fix-drawer",
      state: "thinking",
      title: "Thinking session",
      tokensUsed: 1_250_000,
      updatedAt,
    });
    const activity: SessionActivityItem[] = [
      {
        id: "thinking-1:tool_started:1",
        label: "Started rg",
        state: "using_tool",
        timestamp: updatedAt,
        tool: "rg",
        type: "tool_started",
      },
    ];

    useOfficeStore.setState({
      account: null,
      activityBySession: {
        [liveSession.sessionId]: activity,
      },
      connection: "ready",
      historySessions: [],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [liveSession],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 1,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 1,
      },
      sessions: [],
    });

    render(<App />);

    const liveSessionsSection = screen.getByText("Live sessions").closest("section");

    if (!liveSessionsSection) {
      throw new Error("Expected live sessions section");
    }

    await user.click(within(liveSessionsSection).getByRole("button", { name: /thinking session/i }));

    expect(screen.getByText("Working now", { selector: ".drawer-narrative" })).toBeTruthy();
    expect(screen.getByText("Repo")).toBeTruthy();
    expect(screen.getByText("monorepo")).toBeTruthy();
    expect(screen.getByText("Branch")).toBeTruthy();
    expect(screen.getByText("codex/fix-drawer")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(screen.getByRole("button", { name: /show diagnostics/i })).toBeTruthy();
    expect(screen.queryByText("Tokens used")).toBeNull();
    expect(screen.queryByText("Signal source")).toBeNull();

    await user.click(screen.getByRole("button", { name: /show diagnostics/i }));

    expect(screen.getByText("Tokens used")).toBeTruthy();
    expect(screen.getByText("Signal source")).toBeTruthy();
    expect(screen.getByText("Recent tools")).toBeTruthy();
  });

  it("shows approval and error narratives for selected sessions", async () => {
    const user = userEvent.setup();
    const permissionSession = createSession("permission-1", {
      cwd: "/tmp/api",
      gitBranch: "codex/approval",
      pendingApprovalJustification: "Do you want to allow the daemon to start?",
      state: "permission_needed",
      title: "Permission session",
      updatedAt: new Date(Date.now() - 45_000).toISOString(),
    });
    const errorSession = createSession("error-1", {
      cwd: "/tmp/frontend-app",
      gitBranch: "codex/error-case",
      state: "error",
      title: "Error session",
      updatedAt: new Date(Date.now() - 90_000).toISOString(),
    });
    const errorActivity: SessionActivityItem[] = [
      {
        id: "error-1:state_changed:1",
        label: "Failed to resolve conflict in Header.tsx",
        state: "error",
        timestamp: errorSession.updatedAt,
        tool: null,
        type: "state_changed",
      },
    ];

    useOfficeStore.setState({
      account: null,
      activityBySession: {
        [errorSession.sessionId]: errorActivity,
      },
      connection: "ready",
      historySessions: [],
      lastMutationAt: Date.now(),
      layout: defaultOfficeLayout,
      liveSessions: [permissionSession, errorSession],
      settings: DEFAULT_OFFICE_UI_SETTINGS,
      sessionMeta: {
        hasMoreHistory: false,
        historyCap: 200,
        liveCount: 2,
        nextBefore: null,
        offlineCount: 0,
        trackedCount: 2,
      },
      sessions: [],
    });

    render(<App />);

    const liveSessionsSection = screen.getByText("Live sessions").closest("section");

    if (!liveSessionsSection) {
      throw new Error("Expected live sessions section");
    }

    await user.click(
      within(liveSessionsSection).getByRole("button", { name: /permission session/i }),
    );
    expect(screen.getByText("Do you want to allow the daemon to start?")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /close selected session/i }));

    const refreshedLiveSessionsSection = screen.getByText("Live sessions").closest("section");

    if (!refreshedLiveSessionsSection) {
      throw new Error("Expected live sessions section");
    }

    await user.click(
      within(refreshedLiveSessionsSection).getByRole("button", { name: /error session/i }),
    );
    expect(
      screen.getByText("Failed to resolve conflict in Header.tsx", {
        selector: ".drawer-narrative",
      }),
    ).toBeTruthy();
  });
});
