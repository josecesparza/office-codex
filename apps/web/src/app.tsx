import { useMemo, useState } from "react";

import { officePalette } from "@office-codex/assets";

import { OfficeCanvas } from "./components/office-canvas";
import { basename, formatRelative } from "./lib/format";
import { useOfficeStore } from "./lib/office-store";
import { useOfficeData } from "./lib/use-office-data";

const ROSTER_LIVE_LIMIT = 20;
const OFFLINE_PAGE_SIZE = 20;

const stateLabels: Record<string, string> = {
  inactive: "Idle",
  thinking: "Thinking",
  using_tool: "Using tool",
  responding: "Responding",
  waiting_user: "Waiting",
  offline: "Offline",
  error: "Error",
};

export function App() {
  useOfficeData();

  const connection = useOfficeStore((state) => state.connection);
  const layout = useOfficeStore((state) => state.layout);
  const sessions = useOfficeStore((state) => state.sessions);
  const lastMutationAt = useOfficeStore((state) => state.lastMutationAt);
  const [showOfflineHistory, setShowOfflineHistory] = useState(false);
  const [offlineLimit, setOfflineLimit] = useState(OFFLINE_PAGE_SIZE);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

  const liveSessions = useMemo(
    () => sessions.filter((session) => session.state !== "offline"),
    [sessions],
  );
  const offlineSessions = useMemo(
    () => sessions.filter((session) => session.state === "offline"),
    [sessions],
  );
  const visibleLiveSessions = useMemo(
    () => liveSessions.slice(0, ROSTER_LIVE_LIMIT),
    [liveSessions],
  );
  const visibleOfflineSessions = useMemo(
    () => offlineSessions.slice(0, offlineLimit),
    [offlineLimit, offlineSessions],
  );
  const rosterSessions = useMemo(
    () =>
      showOfflineHistory
        ? [...visibleLiveSessions, ...visibleOfflineSessions]
        : visibleLiveSessions,
    [showOfflineHistory, visibleLiveSessions, visibleOfflineSessions],
  );
  const hiddenOfflineCount = Math.max(offlineSessions.length - visibleOfflineSessions.length, 0);
  const hiddenLiveCount = Math.max(liveSessions.length - visibleLiveSessions.length, 0);

  const metrics = useMemo(
    () => ({
      active: sessions.filter((session) => session.state !== "offline").length,
      waiting: sessions.filter((session) => session.state === "waiting_user").length,
      tooling: sessions.filter((session) => session.state === "using_tool").length,
    }),
    [sessions],
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Office Codex</p>
          <h1>Pixel dashboard for your local Codex sessions</h1>
        </div>
        <div className={`connection connection-${connection}`}>
          <span className="connection-dot" />
          {connection}
        </div>
      </header>

      <section className="metrics">
        <article>
          <strong>{metrics.active}</strong>
          <span>Active agents</span>
        </article>
        <article>
          <strong>{metrics.waiting}</strong>
          <span>Waiting for you</span>
        </article>
        <article>
          <strong>{metrics.tooling}</strong>
          <span>Using tools</span>
        </article>
      </section>

      <main className="workspace">
        <section className="stage-card">
          <div className="stage-header">
            <div>
              <h2>Live office</h2>
              <p>Single canvas, fixed layout, real Codex state.</p>
            </div>
            <div className="stage-meta">
              <span>{layout?.desks.length ?? 0} desks</span>
              <span>{liveSessions.length} live now</span>
            </div>
          </div>
          <div
            className="stage-frame"
            style={{
              boxShadow: `0 18px 60px color-mix(in srgb, ${officePalette.accent} 16%, transparent)`,
            }}
          >
            <OfficeCanvas
              hoveredSessionId={hoveredSessionId}
              layout={layout}
              sessions={liveSessions}
              lastMutationAt={lastMutationAt}
            />
          </div>
        </section>

        <aside className="session-panel">
          <div className="panel-header">
            <div>
              <h2>Session roster</h2>
              <p>Metadata only. No prompt or response text leaves the daemon.</p>
            </div>
            <div className="panel-actions">
              {offlineSessions.length > 0 ? (
                <button
                  className="panel-button"
                  onClick={() => setShowOfflineHistory((current) => !current)}
                  type="button"
                >
                  {showOfflineHistory
                    ? `Hide offline history (${offlineSessions.length})`
                    : `Show offline history (${offlineSessions.length})`}
                </button>
              ) : null}
            </div>
          </div>

          <div className="panel-summary">
            <span>{liveSessions.length} live</span>
            <span>{offlineSessions.length} offline</span>
            <span>showing {rosterSessions.length}</span>
          </div>

          {hiddenLiveCount > 0 ? (
            <p className="panel-summary-note">
              Showing the 20 most recent live sessions in the roster.
            </p>
          ) : null}

          {rosterSessions.length === 0 ? (
            <div className="empty-card">
              <strong>No live sessions right now.</strong>
              <p>
                Start one with `office-codex run -- ...`. You can still inspect the offline history
                whenever you need it.
              </p>
            </div>
          ) : (
            <div className="session-list">
              {rosterSessions.map((session) => (
                <article
                  className="session-card"
                  key={session.sessionId}
                  onMouseEnter={() => setHoveredSessionId(session.sessionId)}
                  onMouseLeave={() =>
                    setHoveredSessionId((current) =>
                      current === session.sessionId ? null : current,
                    )
                  }
                >
                  <div className="session-card-head">
                    <div>
                      <h3>{session.title || session.sessionId}</h3>
                      <p>{basename(session.cwd)}</p>
                    </div>
                    <span className={`badge badge-${session.state}`}>
                      {stateLabels[session.state]}
                    </span>
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
              ))}
            </div>
          )}

          {showOfflineHistory && hiddenOfflineCount > 0 ? (
            <button
              className="panel-button panel-button-secondary"
              onClick={() => setOfflineLimit((current) => current + OFFLINE_PAGE_SIZE)}
              type="button"
            >
              Show 20 more offline sessions ({hiddenOfflineCount} remaining)
            </button>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
