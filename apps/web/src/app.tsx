import { useMemo } from "react";

import { officePalette } from "@office-codex/assets";

import { OfficeCanvas } from "./components/office-canvas";
import { basename, formatRelative } from "./lib/format";
import { useOfficeStore } from "./lib/office-store";
import { useOfficeData } from "./lib/use-office-data";

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
              <span>{sessions.length} sessions</span>
            </div>
          </div>
          <div
            className="stage-frame"
            style={{
              boxShadow: `0 18px 60px color-mix(in srgb, ${officePalette.accent} 16%, transparent)`,
            }}
          >
            <OfficeCanvas layout={layout} sessions={sessions} lastMutationAt={lastMutationAt} />
          </div>
        </section>

        <aside className="session-panel">
          <div className="panel-header">
            <h2>Session roster</h2>
            <p>Metadata only. No prompt or response text leaves the daemon.</p>
          </div>

          {sessions.length === 0 ? (
            <div className="empty-card">
              <strong>No Codex sessions yet.</strong>
              <p>
                Start one with `office-codex run -- ...` or keep the daemon open until one appears.
              </p>
            </div>
          ) : (
            <div className="session-list">
              {sessions.map((session) => (
                <article className="session-card" key={session.sessionId}>
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
        </aside>
      </main>
    </div>
  );
}
