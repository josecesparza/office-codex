import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { defaultOfficeLayout, officePalette } from "@office-codex/assets";
import { MiniAgentAvatar } from "./components/mini-agent-avatar";
import { OfficeCanvas } from "./components/office-canvas";
import { OfficeSettingsSheet } from "./components/office-settings-sheet";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { formatAccountUsageSummary, shouldShowUnavailableUsage } from "./lib/account-usage";
import {
  basename,
  formatCompactNumber,
  formatDateTime,
  formatRelative,
  shortenIdentifier,
} from "./lib/format";
import { type SessionActivityItem, useOfficeStore } from "./lib/office-store";
import {
  type SessionGeometry,
  buildLiveOfficeSessions,
  getAttentionItems,
  getOfficeMetrics,
  getSessionAccent,
  getSessionAccentSoft,
  reconcileDeskAssignments,
} from "./lib/office-ui";
import { useOfficeData } from "./lib/use-office-data";

const TOOLTIP_WIDTH = 276;
const RECENT_OUTCOME_MS = 300_000;

const stateLabels: Record<string, string> = {
  inactive: "Ready",
  thinking: "Thinking",
  using_tool: "Using tool",
  responding: "Responding",
  waiting_user: "Waiting",
  permission_needed: "Permission needed",
  offline: "Offline",
  error: "Error",
};

const connectionLabels: Record<"connecting" | "ready" | "error", string> = {
  connecting: "Connecting",
  error: "Error",
  ready: "Ready",
};

const recentOutcomeEventTypes = new Set(["turn_completed", "turn_cancelled", "turn_rolled_back"]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getTooltipStyle(
  geometry: SessionGeometry,
  stageWidth: number,
  stageHeight: number,
): { className: string; style: CSSProperties } {
  const safeStageWidth = stageWidth || TOOLTIP_WIDTH + 48;
  const tooltipX = clamp(
    geometry.agentCenter.x,
    TOOLTIP_WIDTH / 2 + 16,
    Math.max(TOOLTIP_WIDTH / 2 + 16, safeStageWidth - TOOLTIP_WIDTH / 2 - 16),
  );
  const showBelow = geometry.agentBounds.y < 94;
  const tooltipY = showBelow
    ? Math.min(stageHeight - 16, geometry.agentBounds.y + geometry.agentBounds.height + 12)
    : Math.max(16, geometry.agentBounds.y - 12);

  return {
    className: showBelow ? "office-tooltip office-tooltip-below" : "office-tooltip",
    style: {
      left: `${tooltipX}px`,
      top: `${tooltipY}px`,
      transform: showBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      width: `${TOOLTIP_WIDTH}px`,
    },
  };
}

function looksLikeMachineTitle(title: string, sessionId: string): boolean {
  if (!title || title === sessionId) {
    return true;
  }

  return /^[0-9a-f]{8,}-[0-9a-f-]{8,}$/i.test(title);
}

function getTooltipIdentity(session: {
  cwd: string;
  sessionId: string;
  title: string;
}) {
  const repoName = basename(session.cwd);
  const shortId = shortenIdentifier(session.sessionId, 8, 4);

  if (looksLikeMachineTitle(session.title, session.sessionId)) {
    return {
      primary: repoName,
      secondary: `Session ${shortId}`,
    };
  }

  return {
    primary: session.title,
    secondary: `${repoName} · ${shortId}`,
  };
}

function getRosterIdentity(
  session: {
    cwd: string;
    gitBranch: string | null;
    sessionId: string;
    title: string;
  },
  options: {
    deskBadge?: string;
    offline?: boolean;
  } = {},
) {
  const repoName = basename(session.cwd);
  const shortId = shortenIdentifier(session.sessionId, 8, 4);
  const branch = session.gitBranch?.trim() || null;

  if (!looksLikeMachineTitle(session.title, session.sessionId)) {
    return {
      primary: session.title,
      secondary: branch ? `${repoName} · ${branch}` : `${repoName} · Session ${shortId}`,
    };
  }

  if (options.offline) {
    return {
      primary: `${repoName} / ${shortId}`,
      secondary: branch ? branch : "Session without branch metadata",
    };
  }

  return {
    primary: `${repoName} / ${options.deskBadge ?? shortId}`,
    secondary: branch ? `${branch} · Session ${shortId}` : `Session ${shortId}`,
  };
}

function getCompactSessionMeta(session: {
  cwd: string;
  gitBranch: string | null;
  updatedAt: string;
}) {
  const repoName = basename(session.cwd);
  const branch = session.gitBranch?.trim() || null;

  return branch ? `${repoName} · ${branch}` : `${repoName} · ${formatRelative(session.updatedAt)}`;
}

function getReliabilityIndicator(session: {
  identityConfidence: "high" | "medium" | "low";
  stateConfidence: "high" | "medium" | "low";
}) {
  if (session.identityConfidence === "low" || session.stateConfidence === "low") {
    return {
      description: "Some identity or state signals are currently low confidence.",
      label: "Low confidence",
      tone: "low" as const,
    };
  }

  if (session.stateConfidence === "medium") {
    return {
      description: "The live state signal is starting to age.",
      label: "Signal aging",
      tone: "medium" as const,
    };
  }

  if (session.identityConfidence === "medium") {
    return {
      description: "This session is currently matched through passive metadata or wrapper hints.",
      label: "Passive match",
      tone: "medium" as const,
    };
  }

  return null;
}

interface DrawerField {
  label: string;
  value: string;
}

interface WaitingDrawerCardData {
  options: Array<{
    description: string;
    id: string;
    label: string;
  }>;
  question: string;
}

function isGenericStateActivityLabel(label: string): boolean {
  return label.startsWith("Current state:") || label.startsWith("State ->");
}

function getLatestErrorNarrative(activity: SessionActivityItem[]): string | null {
  const directError = activity.find(
    (item) => item.state === "error" && !isGenericStateActivityLabel(item.label),
  );

  if (directError) {
    return directError.label;
  }

  const fallbackError = activity.find((item) => item.state === "error");
  return fallbackError && !isGenericStateActivityLabel(fallbackError.label)
    ? fallbackError.label
    : null;
}

function getDrawerNarrative(
  session: {
    currentTool: string | null;
    lastUserQuestion: string | null;
    pendingApprovalJustification: string | null;
    state: keyof typeof stateLabels;
  },
  activity: SessionActivityItem[],
): string {
  switch (session.state) {
    case "waiting_user":
      return session.lastUserQuestion ?? "Waiting for your response";
    case "permission_needed":
      return session.pendingApprovalJustification ?? "Needs your approval";
    case "error":
      return getLatestErrorNarrative(activity) ?? "Agent error";
    case "using_tool":
      return session.currentTool ? `Using ${session.currentTool}` : "Working now";
    case "responding":
      return "Preparing a response";
    case "thinking":
      return "Working now";
    case "inactive":
      return "Ready";
    default:
      return stateLabels[session.state] ?? "Working now";
  }
}

function filterRecentOutcomeActivity<
  T extends {
    timestamp: string;
    type: string;
  },
>(items: T[], now: number): T[] {
  return items.filter((item) => {
    if (!recentOutcomeEventTypes.has(item.type)) {
      return true;
    }

    const timestamp = Date.parse(item.timestamp);
    return Number.isFinite(timestamp) && now - timestamp <= RECENT_OUTCOME_MS;
  });
}

export function App() {
  const { historyLoaded, historyLoading, loadMoreHistory } = useOfficeData();

  const connection = useOfficeStore((state) => state.connection);
  const account = useOfficeStore((state) => state.account);
  const activityBySession = useOfficeStore((state) => state.activityBySession);
  const hydrateSettings = useOfficeStore((state) => state.hydrateSettings);
  const historySessions = useOfficeStore((state) => state.historySessions);
  const layout = useOfficeStore((state) => state.layout);
  const liveSessions = useOfficeStore((state) => state.liveSessions);
  const lastMutationAt = useOfficeStore((state) => state.lastMutationAt);
  const resetSettings = useOfficeStore((state) => state.resetSettings);
  const settings = useOfficeStore((state) => state.settings);
  const sessionMeta = useOfficeStore((state) => state.sessionMeta);
  const updateSettings = useOfficeStore((state) => state.updateSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOfflineHistory, setShowOfflineHistory] = useState(
    settings.showOfflineHistoryByDefault,
  );
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [drawerDiagnosticsOpen, setDrawerDiagnosticsOpen] = useState(false);
  const [waitingCardExpanded, setWaitingCardExpanded] = useState(true);
  const [deskAssignments, setDeskAssignments] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [sessionGeometries, setSessionGeometries] = useState<Record<string, SessionGeometry>>({});
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stageFrameRef = useRef<HTMLDivElement | null>(null);
  const previousHistoryPageSizeRef = useRef(settings.historyPageSize);

  const effectiveLayout = layout ?? defaultOfficeLayout;
  const liveCount = sessionMeta?.liveCount ?? liveSessions.length;
  const offlineCount = Math.max(
    sessionMeta?.offlineCount ?? historySessions.length,
    historySessions.length,
  );

  useEffect(() => {
    hydrateSettings();
  }, [hydrateSettings]);

  useEffect(() => {
    setShowOfflineHistory(settings.showOfflineHistoryByDefault);
  }, [settings.showOfflineHistoryByDefault]);

  useEffect(() => {
    setDeskAssignments((current) =>
      reconcileDeskAssignments(current, liveSessions, effectiveLayout),
    );
  }, [effectiveLayout, liveSessions]);

  const resolvedDeskAssignments = useMemo(
    () => reconcileDeskAssignments(deskAssignments, liveSessions, effectiveLayout),
    [deskAssignments, effectiveLayout, liveSessions],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (
      selectedSessionId &&
      !liveSessions.some((session) => session.sessionId === selectedSessionId)
    ) {
      setSelectedSessionId(null);
    }
  }, [liveSessions, selectedSessionId]);

  useEffect(() => {
    setDrawerDiagnosticsOpen(false);
    setWaitingCardExpanded(true);
  }, [selectedSessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSessionId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const stageFrame = stageFrameRef.current;

    if (!stageFrame) {
      return;
    }

    const syncSizes = () => {
      setStageSize({
        height: stageFrame.clientHeight,
        width: stageFrame.clientWidth,
      });
    };

    syncSizes();

    const observer = new ResizeObserver(syncSizes);
    observer.observe(stageFrame);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (
      showOfflineHistory &&
      !historyLoaded &&
      !historyLoading &&
      (offlineCount > 0 || historySessions.length > 0)
    ) {
      void loadMoreHistory({
        reset: true,
      });
    }
  }, [
    historyLoaded,
    historyLoading,
    historySessions.length,
    loadMoreHistory,
    offlineCount,
    showOfflineHistory,
  ]);

  useEffect(() => {
    const previousPageSize = previousHistoryPageSizeRef.current;

    if (previousPageSize === settings.historyPageSize) {
      return;
    }

    previousHistoryPageSizeRef.current = settings.historyPageSize;

    if (showOfflineHistory) {
      void loadMoreHistory({
        limit: settings.historyPageSize,
        reset: true,
      });
    }
  }, [loadMoreHistory, settings.historyPageSize, showOfflineHistory]);

  const liveOfficeSessions = useMemo(
    () => buildLiveOfficeSessions(liveSessions, effectiveLayout, resolvedDeskAssignments, now),
    [effectiveLayout, liveSessions, now, resolvedDeskAssignments],
  );
  const visibleLiveSessions = useMemo(
    () => liveOfficeSessions.slice(0, settings.liveRosterLimit),
    [liveOfficeSessions, settings.liveRosterLimit],
  );
  const visibleOfflineSessions = useMemo(() => historySessions, [historySessions]);
  const hiddenOfflineCount = Math.max(offlineCount - visibleOfflineSessions.length, 0);
  const hiddenLiveCount = Math.max(liveOfficeSessions.length - visibleLiveSessions.length, 0);
  const metrics = useMemo(() => getOfficeMetrics(liveSessions, now), [liveSessions, now]);
  const attentionItems = useMemo(
    () => getAttentionItems(liveOfficeSessions, now),
    [liveOfficeSessions, now],
  );
  const linkedSessionId = selectedSessionId ?? hoveredSessionId;
  const selectedOfficeSession = liveOfficeSessions.find(
    (candidate) => candidate.session.sessionId === selectedSessionId,
  );
  const hoveredOfficeSession = liveOfficeSessions.find(
    (candidate) => candidate.session.sessionId === hoveredSessionId,
  );
  const tooltipGeometry = hoveredSessionId ? sessionGeometries[hoveredSessionId] : null;
  const tooltipTarget =
    selectedSessionId ||
    !settings.showOfficeTooltips ||
    hoveredOfficeSession?.session.state === "offline"
      ? null
      : hoveredOfficeSession;
  const tooltipIdentity = tooltipTarget ? getTooltipIdentity(tooltipTarget.session) : null;
  const selectedActivity = selectedSessionId ? (activityBySession[selectedSessionId] ?? []) : [];
  const visibleSelectedActivity = useMemo(
    () => filterRecentOutcomeActivity(selectedActivity, now),
    [now, selectedActivity],
  );
  const selectedRecentTools = useMemo(
    () =>
      selectedActivity
        .filter((item) => item.type === "tool_started" && item.tool)
        .map((item) => item.tool as string)
        .filter((tool, index, items) => items.indexOf(tool) === index)
        .slice(0, 4),
    [selectedActivity],
  );
  const selectedReliabilityIndicator = selectedOfficeSession
    ? getReliabilityIndicator(selectedOfficeSession.session)
    : null;
  const selectedWaitingCard = useMemo<WaitingDrawerCardData | null>(() => {
    if (!selectedOfficeSession) {
      return null;
    }

    const { session } = selectedOfficeSession;

    if (session.state !== "waiting_user" || !session.lastUserQuestion) {
      return null;
    }

    return {
      options: session.lastUserOptions,
      question: session.lastUserQuestion,
    };
  }, [selectedOfficeSession]);
  const selectedDrawerSummary = useMemo(() => {
    if (!selectedOfficeSession) {
      return null;
    }

    const { session } = selectedOfficeSession;

    return {
      diagnosticsFields: [
        { label: "Started", value: formatDateTime(session.startedAt) },
        { label: "Tokens used", value: formatCompactNumber(session.tokensUsed) },
        { label: "Subtasks", value: String(session.activeSubtasks) },
        {
          label: "Reliability",
          value: selectedReliabilityIndicator?.label ?? "High confidence",
        },
        { label: "Signal source", value: session.stateSource },
      ] satisfies DrawerField[],
      narrative: getDrawerNarrative(session, selectedActivity),
      summaryFields: [
        { label: "Repo", value: basename(session.cwd) },
        { label: "Branch", value: session.gitBranch ?? "unknown" },
        { label: "Updated", value: formatRelative(session.updatedAt) },
      ] satisfies DrawerField[],
    };
  }, [selectedActivity, selectedOfficeSession, selectedReliabilityIndicator]);
  const tooltipPlacement =
    tooltipTarget && tooltipGeometry
      ? getTooltipStyle(tooltipGeometry, stageSize.width, stageSize.height)
      : null;
  const accountUsageSummary = formatAccountUsageSummary(account);
  const usageUnavailable = shouldShowUnavailableUsage(account);
  const usageLabel = accountUsageSummary ?? (usageUnavailable ? "Usage unavailable" : "Usage pending");
  const headerMetrics = [
    { label: "Active", tone: "default", value: metrics.active },
    { label: "Thinking", tone: "default", value: metrics.thinking },
    { label: "Using tools", tone: "default", value: metrics.tooling },
    { label: "Waiting", tone: "default", value: metrics.waiting },
    { label: "Blocked", tone: metrics.blocked > 0 ? "alert" : "default", value: metrics.blocked },
  ] as const;

  const toggleSelection = (sessionId: string | null) => {
    setSelectedSessionId((current) => (current === sessionId ? null : sessionId));
  };

  const handleSettingsChange = (patch: Partial<typeof settings>) => {
    updateSettings(patch);

    if (patch.showOfflineHistoryByDefault !== undefined) {
      setShowOfflineHistory(patch.showOfflineHistoryByDefault);
    }
  };

  const handleResetSettings = () => {
    resetSettings();
    setShowOfflineHistory(false);
  };

  return (
    <div
      className="shell"
      data-compact-mode={settings.compactMode ? "true" : "false"}
      data-reduced-motion={settings.reducedMotion ? "true" : "false"}
    >
      <header className="topbar">
        <div className="topbar-copy">
          <p className="eyebrow">
            <span>OFFICE CODEX:</span>{" "}
            <span className="eyebrow-detail">
              Pixel office supervision for live desks, attention queues, and focused session
              drill-down.
            </span>
          </p>
          <h1>Codex Local</h1>
        </div>

        <div className="topbar-rail">
          <div className="topbar-metrics" aria-label="Office metrics">
            {headerMetrics.map((metric) => (
              <div
                className={`metric-chip ${metric.tone === "alert" ? "metric-chip-alert" : ""}`}
                key={metric.label}
              >
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>

          <OfficeSettingsSheet
            connectionLabel={connectionLabels[connection]}
            connectionState={connection}
            onOpenChange={setSettingsOpen}
            onReset={handleResetSettings}
            onSettingsChange={handleSettingsChange}
            open={settingsOpen}
            settings={settings}
            usageLabel={usageLabel}
            usageTone={accountUsageSummary ? "available" : usageUnavailable ? "unavailable" : "pending"}
          />
        </div>
      </header>

      <main className="workspace">
        <Card className="stage-card">
          <div className="stage-header">
            <div>
              <h2>Live office</h2>
              <p>Identity, selection and activity cues without reading the full roster.</p>
            </div>
            <div className="stage-meta">
              <span>{effectiveLayout.desks.length} desks</span>
              <span>{liveCount} live now</span>
              <span>{offlineCount} offline tracked</span>
            </div>
          </div>

          <div className="stage-scene">
            <div
              className="stage-frame"
              ref={stageFrameRef}
              style={{
                boxShadow: `0 18px 60px color-mix(in srgb, ${officePalette.accent} 16%, transparent)`,
              }}
            >
              <OfficeCanvas
                hoveredSessionId={hoveredSessionId}
                lastMutationAt={lastMutationAt}
                layout={effectiveLayout}
                onHoveredSessionChange={setHoveredSessionId}
                onSelectedSessionChange={toggleSelection}
                onSessionGeometryChange={setSessionGeometries}
                reducedMotion={settings.reducedMotion}
                selectedSessionId={selectedSessionId}
                sessions={liveOfficeSessions}
              />
            </div>

            {tooltipTarget && tooltipGeometry && tooltipPlacement ? (
              <div
                className={tooltipPlacement.className}
                data-testid="office-tooltip"
                style={
                  {
                    ...tooltipPlacement.style,
                    "--tooltip-accent": tooltipTarget.accentColor,
                  } as CSSProperties
                }
              >
                <div className="office-tooltip-meta">
                  <span className="office-tooltip-badge">{tooltipTarget.deskBadge}</span>
                  <span>{stateLabels[tooltipTarget.session.state]}</span>
                </div>
                <strong>{tooltipIdentity?.primary}</strong>
                {settings.tooltipDetailLevel === "full" ? (
                  <>
                    <p className="office-tooltip-subtitle">{tooltipIdentity?.secondary}</p>
                    <dl>
                      <div>
                        <dt>Branch</dt>
                        <dd>{tooltipTarget.session.gitBranch ?? "unknown"}</dd>
                      </div>
                      <div>
                        <dt>Tool</dt>
                        <dd>{tooltipTarget.session.currentTool ?? "none"}</dd>
                      </div>
                    </dl>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>

        <aside
          className={`session-panel ${
            selectedOfficeSession ? "session-panel-detail" : "session-panel-overview"
          }`}
        >
          {selectedOfficeSession ? (
            <Card className="insight-card drawer-card">
              <div className="drawer-header">
                <div className="session-card-identity">
                  <div className="session-card-badge-stack">
                    <span className="desk-badge">{selectedOfficeSession.deskBadge}</span>
                    <MiniAgentAvatar
                      color={selectedOfficeSession.accentColor}
                      label={`Agent ${selectedOfficeSession.deskBadge}`}
                      variant={selectedOfficeSession.variant}
                    />
                  </div>
                  <div>
                    <h3>
                      {
                        getRosterIdentity(selectedOfficeSession.session, {
                          deskBadge: selectedOfficeSession.deskBadge,
                        }).primary
                      }
                    </h3>
                    <div className="drawer-status-line">
                      <Badge
                        className={`badge badge-${selectedOfficeSession.session.state}`}
                        variant="outline"
                      >
                        {stateLabels[selectedOfficeSession.session.state]}
                      </Badge>
                    </div>
                  </div>
                </div>
                <button
                  aria-label="Close selected session"
                  className="drawer-close-button"
                  onClick={() => setSelectedSessionId(null)}
                  type="button"
                >
                  <svg aria-hidden="true" height="16" viewBox="0 0 20 20" width="16">
                    <path
                      d="M5 5l10 10M15 5 5 15"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.6"
                    />
                  </svg>
                  <span className="sr-only">Close selected session</span>
                </button>
              </div>

              {selectedWaitingCard ? (
                <div className="drawer-section waiting-card">
                  <div className="waiting-card-head">
                    <Badge className="badge badge-waiting_user" variant="outline">
                      {stateLabels[selectedOfficeSession.session.state]}
                    </Badge>

                    {selectedWaitingCard.options.length > 0 ? (
                      <button
                        aria-controls="drawer-waiting-options"
                        aria-expanded={waitingCardExpanded}
                        className="drawer-section-toggle"
                        onClick={() => setWaitingCardExpanded((current) => !current)}
                        type="button"
                      >
                        {waitingCardExpanded ? "Hide proposed answers" : "Show proposed answers"}
                      </button>
                    ) : null}
                  </div>

                  <div className="waiting-card-body">
                    <p className="waiting-card-label">Codex question</p>
                    <p className="waiting-card-question">{selectedWaitingCard.question}</p>
                  </div>

                  {selectedWaitingCard.options.length > 0 && waitingCardExpanded ? (
                    <div className="waiting-card-options" id="drawer-waiting-options">
                      <p className="waiting-card-label">Suggested responses</p>
                      <TooltipProvider delayDuration={0}>
                        <ul className="waiting-option-list">
                          {selectedWaitingCard.options.map((option) => (
                            <li className="waiting-option-item" key={option.id}>
                              <div className="waiting-option-card">
                                <span className="waiting-option-label">{option.label}</span>
                                {option.description ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        aria-label={`Details for ${option.label}`}
                                        className="waiting-option-info"
                                        type="button"
                                      >
                                        <svg
                                          aria-hidden="true"
                                          height="14"
                                          viewBox="0 0 20 20"
                                          width="14"
                                        >
                                          <circle
                                            cx="10"
                                            cy="10"
                                            fill="none"
                                            r="7"
                                            stroke="currentColor"
                                            strokeWidth="1.4"
                                          />
                                          <path
                                            d="M10 8.3V13"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeLinecap="round"
                                            strokeWidth="1.4"
                                          />
                                          <circle cx="10" cy="6.3" fill="currentColor" r="0.9" />
                                        </svg>
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{option.description}</TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </div>
                            </li>
                          ))}
                          <li className="waiting-option-note">
                            You can answer differently in freeform.
                          </li>
                        </ul>
                      </TooltipProvider>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="drawer-section">
                  <p className="drawer-narrative">{selectedDrawerSummary?.narrative}</p>
                  <dl className="drawer-grid drawer-grid-summary">
                    {selectedDrawerSummary?.summaryFields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              <div className="drawer-section">
                <div className="drawer-section-head">
                  <h4>Recent activity</h4>
                </div>
                {visibleSelectedActivity.length === 0 ? (
                  <p className="insight-empty">No activity recorded yet.</p>
                ) : (
                  <ol className="timeline-list">
                    {visibleSelectedActivity.slice(0, 4).map((item) => (
                      <li key={item.id}>
                        <span className={`timeline-dot timeline-dot-${item.state}`} />
                        <div>
                          <strong>{item.label}</strong>
                          <span>{formatRelative(item.timestamp)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="drawer-section drawer-diagnostics">
                <div className="drawer-section-head">
                  <h4>Diagnostics</h4>
                  <button
                    aria-controls="drawer-diagnostics-panel"
                    aria-expanded={drawerDiagnosticsOpen}
                    className="drawer-section-toggle"
                    onClick={() => setDrawerDiagnosticsOpen((current) => !current)}
                    type="button"
                  >
                    {drawerDiagnosticsOpen ? "Hide diagnostics" : "Show diagnostics"}
                  </button>
                </div>

                {drawerDiagnosticsOpen ? (
                  <div className="drawer-diagnostics-body" id="drawer-diagnostics-panel">
                    <dl className="drawer-grid drawer-grid-diagnostics">
                      {selectedDrawerSummary?.diagnosticsFields.map((field) => (
                        <div key={field.label}>
                          <dt>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>

                    {selectedOfficeSession.session.reliabilityHints.length > 0 ? (
                      <div className="drawer-diagnostics-section">
                        <h5>Reliability notes</h5>
                        <ul className="hint-list">
                          {selectedOfficeSession.session.reliabilityHints.map((hint) => (
                            <li key={hint}>{hint}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {selectedRecentTools.length > 0 ? (
                      <div className="drawer-diagnostics-section">
                        <h5>Recent tools</h5>
                        <div className="tool-chip-list">
                          {selectedRecentTools.map((tool) => (
                            <span className="tool-chip" key={tool}>
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          ) : (
            <>
              <div className="panel-header">
                <div>
                  <h2>Session overview</h2>
                  <p>Attention first, then live desks, with offline history tucked below.</p>
                </div>
              </div>

              {settings.showAttentionInbox && attentionItems.length > 0 ? (
                <section className="panel-section">
                  <div className="panel-subheader">
                    <h3>Attention</h3>
                    <p>Sessions that need action or are waiting on you.</p>
                  </div>

                  <div className="attention-list">
                    {attentionItems.map((item) => {
                      const sessionIdentity = getRosterIdentity(item.session.session, {
                        deskBadge: item.session.deskBadge,
                      });

                      return (
                        <button
                          className={`attention-item attention-item-${item.severity}`}
                          key={`${item.session.session.sessionId}:${item.reason}`}
                          onClick={() => toggleSelection(item.session.session.sessionId)}
                          type="button"
                        >
                          <span className="attention-badge">{item.session.deskBadge}</span>
                          <span className="attention-copy">
                            <strong>{sessionIdentity.primary}</strong>
                            <span>{item.reason}</span>
                            {item.response ? (
                              <span className="attention-response">Response: {item.response}</span>
                            ) : null}
                            {item.detail ? (
                              <span className="attention-detail">{item.detail}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="panel-section">
                <div className="panel-subheader">
                  <h3>Live sessions</h3>
                  <p>
                    {liveCount} live across {effectiveLayout.desks.length} desks.
                  </p>
                </div>

                {hiddenLiveCount > 0 ? (
                  <p className="panel-summary-note">
                    Showing the first {settings.liveRosterLimit} live desks in spatial order.
                  </p>
                ) : null}

                {visibleLiveSessions.length === 0 ? (
                  <Card className="empty-card">
                    <strong>No live sessions right now.</strong>
                    <p>
                      Start one with `office-codex run -- ...`. You can still inspect the offline
                      history whenever you need it.
                    </p>
                  </Card>
                ) : (
                  <div className="session-list session-list-compact">
                    {visibleLiveSessions.map((renderSession) => {
                      const { accentColor, deskBadge, isBlocked, session } = renderSession;
                      const isLinked = linkedSessionId === session.sessionId;
                      const sessionIdentity = getRosterIdentity(session, { deskBadge });

                      return (
                        <button
                          className={`session-card session-card-live session-card-compact ${
                            isBlocked ? "session-card-blocked" : ""
                          } ${isLinked ? "session-card-active" : ""}`}
                          key={session.sessionId}
                          onClick={() => toggleSelection(session.sessionId)}
                          onFocus={() => setHoveredSessionId(session.sessionId)}
                          onBlur={() =>
                            setHoveredSessionId((current) =>
                              current === session.sessionId ? null : current,
                            )
                          }
                          onMouseEnter={() => setHoveredSessionId(session.sessionId)}
                          onMouseLeave={() =>
                            setHoveredSessionId((current) =>
                              current === session.sessionId ? null : current,
                            )
                          }
                          type="button"
                          style={
                            {
                              "--session-accent": accentColor,
                              "--session-accent-soft": renderSession.accentSoft,
                            } as CSSProperties
                          }
                        >
                          <div className="session-card-head">
                            <div className="session-card-identity">
                              <span className="desk-badge">{deskBadge}</span>
                              <div>
                                <h3>{sessionIdentity.primary}</h3>
                                <p>{getCompactSessionMeta(session)}</p>
                              </div>
                            </div>
                            <div className="session-card-status">
                              <Badge className={`badge badge-${session.state}`} variant="outline">
                                {stateLabels[session.state]}
                              </Badge>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {offlineCount > 0 ? (
                <section className="panel-section panel-section-history">
                  <div className="panel-header panel-header-inline">
                    <div>
                      <h2>Offline history</h2>
                      <p>Chronological only and collapsed by default.</p>
                    </div>
                    <div className="panel-actions">
                      <Button
                        className="panel-button"
                        onClick={() => setShowOfflineHistory((current) => !current)}
                        type="button"
                        variant="default"
                      >
                        {showOfflineHistory
                          ? "Hide history"
                          : `Show history (${offlineCount})`}
                      </Button>
                    </div>
                  </div>

                  {showOfflineHistory ? (
                    historyLoading && visibleOfflineSessions.length === 0 ? (
                      <Card className="empty-card">
                        <strong>Loading offline history.</strong>
                        <p>Fetching the most recent offline sessions from the daemon.</p>
                      </Card>
                    ) : (
                      <div className="session-list session-list-compact">
                        {visibleOfflineSessions.map((session) => {
                          const accentColor = getSessionAccent(session.sessionId);
                          const sessionIdentity = getRosterIdentity(session, { offline: true });

                          return (
                            <article
                              className="session-card session-card-offline session-card-compact"
                              key={session.sessionId}
                              style={
                                {
                                  "--session-accent": accentColor,
                                  "--session-accent-soft": getSessionAccentSoft(session.sessionId),
                                } as CSSProperties
                              }
                            >
                              <div className="session-card-head">
                                <div className="session-card-identity">
                                  <span className="desk-badge desk-badge-offline">OFF</span>
                                  <div>
                                    <h3>{sessionIdentity.primary}</h3>
                                    <p>{getCompactSessionMeta(session)}</p>
                                  </div>
                                </div>
                                <div className="session-card-status">
                                  <Badge
                                    className={`badge badge-${session.state}`}
                                    variant="outline"
                                  >
                                    {stateLabels[session.state]}
                                  </Badge>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )
                  ) : null}

                  {showOfflineHistory && hiddenOfflineCount > 0 ? (
                    <Button
                      className="panel-button panel-button-secondary"
                      disabled={historyLoading}
                      onClick={() => void loadMoreHistory()}
                      type="button"
                      variant="secondary"
                    >
                      {historyLoading
                        ? "Loading offline history..."
                        : `Show ${settings.historyPageSize} more offline sessions (${hiddenOfflineCount} remaining)`}
                    </Button>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
