import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { defaultOfficeLayout, officePalette } from "@office-codex/assets";
import { MiniAgentAvatar } from "./components/mini-agent-avatar";
import { OfficeCanvas } from "./components/office-canvas";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Separator } from "./components/ui/separator";
import { formatAccountUsageSummary, shouldShowUnavailableUsage } from "./lib/account-usage";
import {
  basename,
  formatCompactNumber,
  formatDateTime,
  formatRelative,
  shortenIdentifier,
} from "./lib/format";
import { useOfficeStore } from "./lib/office-store";
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

const ROSTER_LIVE_LIMIT = 20;
const OFFLINE_PAGE_SIZE = 20;
const CONNECTOR_MIN_WIDTH = 1080;
const TOOLTIP_WIDTH = 276;

const stateLabels: Record<string, string> = {
  inactive: "Idle",
  thinking: "Thinking",
  using_tool: "Using tool",
  responding: "Responding",
  waiting_user: "Waiting",
  offline: "Offline",
  error: "Error",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildConnectorPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
): string {
  const controlOffset = Math.max(72, Math.abs(start.x - end.x) * 0.35);

  return `M ${start.x} ${start.y} C ${start.x - controlOffset} ${start.y}, ${
    end.x + controlOffset
  } ${end.y}, ${end.x} ${end.y}`;
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

export function App() {
  const { historyLoaded, historyLoading, loadMoreHistory } = useOfficeData();

  const connection = useOfficeStore((state) => state.connection);
  const account = useOfficeStore((state) => state.account);
  const activityBySession = useOfficeStore((state) => state.activityBySession);
  const historySessions = useOfficeStore((state) => state.historySessions);
  const layout = useOfficeStore((state) => state.layout);
  const liveSessions = useOfficeStore((state) => state.liveSessions);
  const lastMutationAt = useOfficeStore((state) => state.lastMutationAt);
  const sessionMeta = useOfficeStore((state) => state.sessionMeta);
  const [showOfflineHistory, setShowOfflineHistory] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [deskAssignments, setDeskAssignments] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [sessionGeometries, setSessionGeometries] = useState<Record<string, SessionGeometry>>({});
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const [connectorPath, setConnectorPath] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const stageFrameRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const effectiveLayout = layout ?? defaultOfficeLayout;
  const liveCount = sessionMeta?.liveCount ?? liveSessions.length;
  const offlineCount = Math.max(
    sessionMeta?.offlineCount ?? historySessions.length,
    historySessions.length,
  );

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
    const workspace = workspaceRef.current;

    if (!stageFrame || !workspace) {
      return;
    }

    const syncSizes = () => {
      setStageSize({
        height: stageFrame.clientHeight,
        width: stageFrame.clientWidth,
      });
      setWorkspaceSize({
        height: workspace.clientHeight,
        width: workspace.clientWidth,
      });
    };

    syncSizes();

    const observer = new ResizeObserver(syncSizes);
    observer.observe(stageFrame);
    observer.observe(workspace);

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

  const liveOfficeSessions = useMemo(
    () => buildLiveOfficeSessions(liveSessions, effectiveLayout, resolvedDeskAssignments, now),
    [effectiveLayout, liveSessions, now, resolvedDeskAssignments],
  );
  const visibleLiveSessions = useMemo(
    () => liveOfficeSessions.slice(0, ROSTER_LIVE_LIMIT),
    [liveOfficeSessions],
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
    hoveredOfficeSession?.session.state === "offline" ? null : hoveredOfficeSession;
  const tooltipIdentity = tooltipTarget ? getTooltipIdentity(tooltipTarget.session) : null;
  const selectedActivity = selectedSessionId ? (activityBySession[selectedSessionId] ?? []) : [];
  const selectedRecentTools = useMemo(
    () =>
      selectedActivity
        .filter((item) => item.type === "tool_started" && item.tool)
        .map((item) => item.tool as string)
        .filter((tool, index, items) => items.indexOf(tool) === index)
        .slice(0, 4),
    [selectedActivity],
  );

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const stageFrame = stageFrameRef.current;
    const selectedGeometry = selectedSessionId ? sessionGeometries[selectedSessionId] : null;
    const selectedCard = selectedSessionId ? cardRefs.current.get(selectedSessionId) : null;
    const selectedCardVisible = selectedSessionId
      ? visibleLiveSessions.some((session) => session.session.sessionId === selectedSessionId)
      : false;

    if (!workspace || !stageFrame || !selectedGeometry || !selectedCard || !selectedCardVisible) {
      setConnectorPath(null);
      return;
    }

    if (workspaceSize.width < CONNECTOR_MIN_WIDTH) {
      setConnectorPath(null);
      return;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const stageRect = stageFrame.getBoundingClientRect();
    const cardRect = selectedCard.getBoundingClientRect();
    const start = {
      x: cardRect.left - workspaceRect.left,
      y: cardRect.top - workspaceRect.top + cardRect.height / 2,
    };
    const end = {
      x: stageRect.left - workspaceRect.left + selectedGeometry.deskCenter.x,
      y: stageRect.top - workspaceRect.top + selectedGeometry.deskCenter.y,
    };

    setConnectorPath(buildConnectorPath(start, end));
  }, [selectedSessionId, sessionGeometries, visibleLiveSessions, workspaceSize]);

  const tooltipPlacement =
    tooltipTarget && tooltipGeometry
      ? getTooltipStyle(tooltipGeometry, stageSize.width, stageSize.height)
      : null;
  const accountUsageSummary = formatAccountUsageSummary(account);

  const totalVisibleSessions =
    visibleLiveSessions.length + (showOfflineHistory ? visibleOfflineSessions.length : 0);

  const setCardRef = (sessionId: string) => (node: HTMLElement | null) => {
    if (node) {
      cardRefs.current.set(sessionId, node);
      return;
    }

    cardRefs.current.delete(sessionId);
  };

  const toggleSelection = (sessionId: string | null) => {
    setSelectedSessionId((current) => (current === sessionId ? null : sessionId));
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Office Codex</p>
          <h1>Pixel dashboard for your local Codex sessions</h1>
        </div>
        <div className="topbar-status">
          <div className={`connection connection-${connection}`}>
            <span className="connection-dot" />
            {connection}
          </div>
          {accountUsageSummary ? (
            <div className="connection connection-usage">
              <span className="connection-dot connection-dot-usage" />
              <span>{accountUsageSummary}</span>
            </div>
          ) : shouldShowUnavailableUsage(account) ? (
            <div className="connection connection-usage connection-usage-unavailable">
              <span className="connection-dot connection-dot-usage" />
              <span>usage unavailable</span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="health-strip">
        <Card className="health-card">
          <span>Active</span>
          <strong>{metrics.active}</strong>
        </Card>
        <Card className="health-card">
          <span>Thinking</span>
          <strong>{metrics.thinking}</strong>
        </Card>
        <Card className="health-card">
          <span>Using tools</span>
          <strong>{metrics.tooling}</strong>
        </Card>
        <Card className="health-card">
          <span>Waiting</span>
          <strong>{metrics.waiting}</strong>
        </Card>
        <Card className={`health-card ${metrics.blocked > 0 ? "health-card-alert" : ""}`}>
          <span>Blocked</span>
          <strong>{metrics.blocked}</strong>
        </Card>
      </section>

      <main className="workspace" ref={workspaceRef}>
        {connectorPath && selectedOfficeSession ? (
          <svg
            className="workspace-overlay"
            preserveAspectRatio="none"
            viewBox={`0 0 ${Math.max(workspaceSize.width, 1)} ${Math.max(workspaceSize.height, 1)}`}
          >
            <title>Selected session connector</title>
            <path
              d={connectorPath}
              fill="none"
              opacity="0.25"
              stroke={selectedOfficeSession.accentSoft}
              strokeLinecap="round"
              strokeWidth="12"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={connectorPath}
              fill="none"
              opacity="0.72"
              stroke={selectedOfficeSession.accentColor}
              strokeDasharray="10 12"
              strokeLinecap="round"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}

        <Card className="stage-card">
          <div className="stage-header">
            <div>
              <h2>Live office</h2>
              <p>Identity, selection and activity cues without reading the roster.</p>
            </div>
            <div className="stage-meta">
              <span>{effectiveLayout.desks.length} desks</span>
              <span>{liveOfficeSessions.length} live now</span>
              <span>{metrics.blocked} blocked</span>
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
                selectedSessionId={selectedSessionId}
                sessions={liveOfficeSessions}
              />
            </div>

            {tooltipTarget && tooltipGeometry && tooltipPlacement ? (
              <div
                className={tooltipPlacement.className}
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
              </div>
            ) : null}
          </div>
        </Card>

        <aside className="session-panel">
          <Card className="insight-card">
            <div className="panel-subheader">
              <h3>Attention inbox</h3>
              <p>Only sessions that need action or have been waiting too long.</p>
            </div>

            {attentionItems.length === 0 ? (
              <p className="insight-empty">No blocked sessions right now.</p>
            ) : (
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
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {selectedOfficeSession ? (
            <Card className="insight-card drawer-card">
              <div className="panel-subheader">
                <h3>Session drawer</h3>
                <p>
                  {
                    getRosterIdentity(selectedOfficeSession.session, {
                      deskBadge: selectedOfficeSession.deskBadge,
                    }).secondary
                  }
                </p>
              </div>

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
                    <p>{selectedOfficeSession.session.state.replaceAll("_", " ")}</p>
                  </div>
                </div>
                <Button
                  className="panel-button panel-button-ghost"
                  onClick={() => setSelectedSessionId(null)}
                  variant="ghost"
                  type="button"
                >
                  Clear
                </Button>
              </div>

              <dl className="drawer-grid">
                <div>
                  <dt>Repo</dt>
                  <dd>{basename(selectedOfficeSession.session.cwd)}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>{selectedOfficeSession.session.gitBranch ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatDateTime(selectedOfficeSession.session.startedAt)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatRelative(selectedOfficeSession.session.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Tokens used</dt>
                  <dd>{formatCompactNumber(selectedOfficeSession.session.tokensUsed)}</dd>
                </div>
                <div>
                  <dt>Subtasks</dt>
                  <dd>{selectedOfficeSession.session.activeSubtasks}</dd>
                </div>
              </dl>

              <div className="drawer-section">
                <div className="drawer-section-head">
                  <h4>Recent tools</h4>
                </div>
                {selectedRecentTools.length === 0 ? (
                  <p className="insight-empty">No tool activity recorded yet.</p>
                ) : (
                  <div className="tool-chip-list">
                    {selectedRecentTools.map((tool) => (
                      <span className="tool-chip" key={tool}>
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="drawer-section">
                <div className="drawer-section-head">
                  <h4>Activity timeline</h4>
                </div>
                {selectedActivity.length === 0 ? (
                  <p className="insight-empty">No activity recorded yet.</p>
                ) : (
                  <ol className="timeline-list">
                    {selectedActivity.slice(0, 6).map((item) => (
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
            </Card>
          ) : null}

          {selectedOfficeSession ? <Separator className="my-1" /> : null}

          <div className="panel-header">
            <div>
              <h2>Session roster</h2>
              <p>Live sessions follow desk order. Offline history stays separate.</p>
            </div>
            <div className="panel-actions">
              {offlineCount > 0 ? (
                <Button
                  className="panel-button"
                  onClick={() => setShowOfflineHistory((current) => !current)}
                  type="button"
                  variant="default"
                >
                  {showOfflineHistory
                    ? `Hide offline history (${offlineCount})`
                    : `Show offline history (${offlineCount})`}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="panel-summary">
            <span>{liveCount} live</span>
            <span>{offlineCount} offline</span>
            <span>showing {totalVisibleSessions}</span>
          </div>

          {hiddenLiveCount > 0 ? (
            <p className="panel-summary-note">Showing the first 20 live desks in spatial order.</p>
          ) : null}

          {visibleLiveSessions.length === 0 ? (
            <Card className="empty-card">
              <strong>No live sessions right now.</strong>
              <p>
                Start one with `office-codex run -- ...`. You can still inspect the offline history
                whenever you need it.
              </p>
            </Card>
          ) : (
            <div className="session-list">
              {visibleLiveSessions.map((renderSession) => {
                const { accentColor, deskBadge, isBlocked, session, variant } = renderSession;
                const isSelected = selectedSessionId === session.sessionId;
                const isLinked = !selectedSessionId && linkedSessionId === session.sessionId;
                const sessionIdentity = getRosterIdentity(session, { deskBadge });

                return (
                  <div
                    className={`session-card session-card-live ${
                      isBlocked ? "session-card-blocked" : ""
                    } ${isSelected ? "session-card-selected" : ""} ${
                      isLinked ? "session-card-active" : ""
                    }`}
                    key={session.sessionId}
                    onMouseEnter={() => setHoveredSessionId(session.sessionId)}
                    onMouseLeave={() =>
                      setHoveredSessionId((current) =>
                        current === session.sessionId ? null : current,
                      )
                    }
                    onMouseUp={() => toggleSelection(session.sessionId)}
                    ref={setCardRef(session.sessionId)}
                    style={
                      {
                        "--session-accent": accentColor,
                        "--session-accent-soft": renderSession.accentSoft,
                      } as CSSProperties
                    }
                  >
                    <div className="session-card-head">
                      <div className="session-card-identity">
                        <div className="session-card-badge-stack">
                          <span className="desk-badge">{deskBadge}</span>
                          <MiniAgentAvatar
                            color={accentColor}
                            label={`Agent ${deskBadge}`}
                            variant={variant}
                          />
                        </div>
                        <div>
                          <h3>{sessionIdentity.primary}</h3>
                          <p>{sessionIdentity.secondary}</p>
                        </div>
                      </div>
                      <Badge className={`badge badge-${session.state}`} variant="outline">
                        {stateLabels[session.state]}
                      </Badge>
                    </div>
                    <dl>
                      <div>
                        <dt>Branch</dt>
                        <dd>{session.gitBranch ?? "unknown"}</dd>
                      </div>
                      <div>
                        <dt>Tool</dt>
                        <dd>{session.currentTool ?? "none"}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatRelative(session.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt>Subtasks</dt>
                        <dd>{session.activeSubtasks}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          )}

          {showOfflineHistory ? (
            <>
              <div className="panel-subheader">
                <h3>Offline history</h3>
                <p>
                  Chronological only. Cards keep avatar color, but they no longer map to a live
                  desk.
                </p>
              </div>

              {historyLoading && visibleOfflineSessions.length === 0 ? (
                <Card className="empty-card">
                  <strong>Loading offline history.</strong>
                  <p>Fetching the most recent offline sessions from the daemon.</p>
                </Card>
              ) : (
                <div className="session-list">
                  {visibleOfflineSessions.map((session) => {
                    const accentColor = getSessionAccent(session.sessionId);
                    const sessionIdentity = getRosterIdentity(session, { offline: true });

                    return (
                      <article
                        className="session-card session-card-offline"
                        key={session.sessionId}
                        onMouseEnter={() => setHoveredSessionId(session.sessionId)}
                        onMouseLeave={() =>
                          setHoveredSessionId((current) =>
                            current === session.sessionId ? null : current,
                          )
                        }
                        style={
                          {
                            "--session-accent": accentColor,
                            "--session-accent-soft": getSessionAccentSoft(session.sessionId),
                          } as CSSProperties
                        }
                      >
                        <div className="session-card-head">
                          <div className="session-card-identity">
                            <div className="session-card-badge-stack">
                              <span className="desk-badge desk-badge-offline">OFF</span>
                              <MiniAgentAvatar
                                color={accentColor}
                                label="Offline agent"
                                variant={0}
                              />
                            </div>
                            <div>
                              <h3>{sessionIdentity.primary}</h3>
                              <p>{sessionIdentity.secondary}</p>
                            </div>
                          </div>
                          <Badge className={`badge badge-${session.state}`} variant="outline">
                            {stateLabels[session.state]}
                          </Badge>
                        </div>
                        <dl>
                          <div>
                            <dt>Branch</dt>
                            <dd>{session.gitBranch ?? "unknown"}</dd>
                          </div>
                          <div>
                            <dt>Tool</dt>
                            <dd>{session.currentTool ?? "none"}</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{formatRelative(session.updatedAt)}</dd>
                          </div>
                          <div>
                            <dt>Subtasks</dt>
                            <dd>{session.activeSubtasks}</dd>
                          </div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
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
                : `Show ${OFFLINE_PAGE_SIZE} more offline sessions (${hiddenOfflineCount} remaining)`}
            </Button>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
