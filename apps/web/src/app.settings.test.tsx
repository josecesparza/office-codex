// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultOfficeLayout } from "@office-codex/assets";
import { createAgentSession } from "@office-codex/core";
import type { AgentSession } from "@office-codex/core";

import { App } from "./app";
import { DEFAULT_OFFICE_UI_SETTINGS } from "./lib/office-settings";
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

    expect(screen.queryByText("Offline history")).toBeNull();

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: /show offline history by default/i }));
    expect(screen.getByText("Offline history")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates live roster limit, history page size, tooltip visibility and reduced motion", async () => {
    const user = userEvent.setup();
    const liveSessions = buildLiveSessions(15);

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

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    await user.hover(screen.getByTestId("office-canvas"));
    expect(container.querySelector(".office-tooltip")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /open settings/i }));
    await user.click(screen.getByRole("switch", { name: /show office tooltips/i }));
    expect(container.querySelector(".office-tooltip")).toBeNull();

    await user.click(screen.getByRole("switch", { name: /reduced motion/i }));
    expect(screen.getByTestId("office-canvas").getAttribute("data-reduced-motion")).toBe("true");

    await user.click(screen.getByRole("button", { name: /close settings/i }));
    await user.click(screen.getByRole("button", { name: /show offline history/i }));
    await user.click(screen.getByRole("button", { name: /open settings/i }));
    loadMoreHistory.mockClear();

    await user.click(screen.getByRole("combobox", { name: /offline history page size/i }));
    await user.click(screen.getByText("50 history cards"));

    expect(loadMoreHistory).toHaveBeenCalledWith({
      limit: 50,
      reset: true,
    });
  });
});
