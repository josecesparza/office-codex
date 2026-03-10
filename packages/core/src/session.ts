import type { AgentSession, AgentSessionSeed, ConfidenceLevel, OfflineReason } from "./types.js";

const confidenceRank: Record<ConfidenceLevel, number> = {
  high: 2,
  low: 0,
  medium: 1,
};

const ACTIVE_SIGNAL_STATES = new Set<AgentSession["state"]>([
  "thinking",
  "using_tool",
  "responding",
  "permission_needed",
]);

function maxConfidence(left: ConfidenceLevel, right: ConfidenceLevel): ConfidenceLevel {
  return confidenceRank[left] >= confidenceRank[right] ? left : right;
}

function minConfidence(left: ConfidenceLevel, right: ConfidenceLevel): ConfidenceLevel {
  return confidenceRank[left] <= confidenceRank[right] ? left : right;
}

function deriveIdentityConfidence(session: AgentSession): ConfidenceLevel {
  if (session.rolloutPath.trim()) {
    return "high";
  }

  if (session.stateSource === "wrapper" || session.source === "wrapper") {
    return "medium";
  }

  return "low";
}

function deriveStateConfidence(session: AgentSession, now: number): ConfidenceLevel {
  if (!ACTIVE_SIGNAL_STATES.has(session.state)) {
    return "high";
  }

  const updatedAt = Date.parse(session.updatedAt);

  if (!Number.isFinite(updatedAt)) {
    return "low";
  }

  const age = Math.max(0, now - updatedAt);

  if (age <= 30_000) {
    return "high";
  }

  if (age <= 120_000) {
    return "medium";
  }

  return "low";
}

function offlineReasonHint(reason: OfflineReason | null): string | null {
  switch (reason) {
    case "archived":
      return "Session is shown from archived metadata.";
    case "idle_timeout":
      return "Session was marked offline after inactivity.";
    case "wrapper_exit":
      return "Session was marked offline after the wrapper exited.";
    case "unknown":
      return "Session was marked offline without a precise exit reason.";
    default:
      return null;
  }
}

export function materializeAgentSession(
  session: AgentSession,
  now: number = Date.now(),
): AgentSession {
  const identityConfidence = maxConfidence(
    session.identityConfidence,
    deriveIdentityConfidence(session),
  );
  const stateConfidence = minConfidence(
    session.stateConfidence,
    deriveStateConfidence(session, now),
  );
  const reliabilityHints = [...session.reliabilityHints];

  if (
    identityConfidence === "medium" &&
    !reliabilityHints.includes("Session identity is based on wrapper hints.")
  ) {
    reliabilityHints.push("Session identity is based on wrapper hints.");
  }

  if (
    identityConfidence === "low" &&
    !reliabilityHints.includes("Session identity is based on metadata only.")
  ) {
    reliabilityHints.push("Session identity is based on metadata only.");
  }

  if (
    stateConfidence === "medium" &&
    !reliabilityHints.includes("Live state signal is getting stale.")
  ) {
    reliabilityHints.push("Live state signal is getting stale.");
  }

  if (stateConfidence === "low" && !reliabilityHints.includes("Live state signal is stale.")) {
    reliabilityHints.push("Live state signal is stale.");
  }

  const offlineHint = offlineReasonHint(session.offlineReason);

  if (offlineHint && !reliabilityHints.includes(offlineHint)) {
    reliabilityHints.push(offlineHint);
  }

  if (
    session.state === "permission_needed" &&
    session.pendingApprovalJustification &&
    !reliabilityHints.includes(session.pendingApprovalJustification)
  ) {
    reliabilityHints.push(session.pendingApprovalJustification);
  }

  return {
    ...session,
    identityConfidence,
    stateConfidence,
    reliabilityHints,
  };
}

export function createAgentSession(seed: AgentSessionSeed): AgentSession {
  const updatedAt = seed.updatedAt ?? seed.startedAt;

  return {
    sessionId: seed.sessionId,
    source: seed.source,
    title: seed.title,
    cwd: seed.cwd,
    gitBranch: seed.gitBranch ?? null,
    tokensUsed: seed.tokensUsed ?? null,
    rolloutPath: seed.rolloutPath,
    startedAt: seed.startedAt,
    updatedAt,
    seatId: seed.seatId ?? null,
    activeSubtasks: 0,
    currentTool: null,
    state: "inactive",
    identityConfidence: seed.identityConfidence ?? "low",
    stateConfidence: seed.stateConfidence ?? "high",
    reliabilityHints: seed.reliabilityHints ?? [],
    stateSource: seed.stateSource ?? (seed.source === "wrapper" ? "wrapper" : "transcript"),
    lastTurnOutcome: seed.lastTurnOutcome ?? null,
    lastTurnOutcomeAt: seed.lastTurnOutcomeAt ?? null,
    pendingApprovalJustification: seed.pendingApprovalJustification ?? null,
    lastUserQuestion: seed.lastUserQuestion ?? null,
    lastUserAnswer: seed.lastUserAnswer ?? null,
    offlineReason: seed.offlineReason ?? null,
    lastEventAt: updatedAt,
    lastEventType: null,
  };
}
