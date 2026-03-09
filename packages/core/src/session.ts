import type { AgentSession, AgentSessionSeed } from "./types.js";

export function createAgentSession(seed: AgentSessionSeed): AgentSession {
  const updatedAt = seed.updatedAt ?? seed.startedAt;

  return {
    sessionId: seed.sessionId,
    source: seed.source,
    title: seed.title,
    cwd: seed.cwd,
    gitBranch: seed.gitBranch ?? null,
    rolloutPath: seed.rolloutPath,
    startedAt: seed.startedAt,
    updatedAt,
    seatId: seed.seatId ?? null,
    activeSubtasks: 0,
    currentTool: null,
    state: "inactive",
    lastEventAt: updatedAt,
    lastEventType: null,
  };
}
