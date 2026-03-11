import { agentPalette } from "@office-codex/assets";
import type { AgentSession, DeskAnchor, OfficeLayout } from "@office-codex/core";
import type { SessionActivityItem } from "./office-store";

const OVERFLOW_PREFIX = "overflow:";

export const BLOCKED_WAIT_MS = 240_000;
export const HEATMAP_WINDOW_MS = 300_000;
export const RECENTLY_FINISHED_MS = 180_000;

export interface SessionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionGeometry {
  agentBounds: SessionRect;
  agentCenter: { x: number; y: number };
  deskBounds: SessionRect;
  deskCenter: { x: number; y: number };
}

export interface OfficeRenderSession {
  session: AgentSession;
  accentColor: string;
  accentSoft: string;
  desk: DeskAnchor | null;
  deskBadge: string;
  isBlocked: boolean;
  overflow: boolean;
  overflowIndex: number | null;
  slotKey: string;
  slotOrder: number;
  variant: number;
}

export interface AttentionItem {
  detail?: string;
  headline: string;
  kind:
    | "needs_answer"
    | "needs_approval"
    | "error"
    | "stuck"
    | "response_recorded"
    | "finished";
  occurredAt: string;
  section: "action_now" | "watch_closely" | "recently_finished";
  session: OfficeRenderSession;
  severity: "critical" | "warning" | "info";
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixHex(hex: string, targetHex: string, amount: number): string {
  const normalized = hex.replace("#", "");
  const target = targetHex.replace("#", "");

  if (normalized.length !== 6 || target.length !== 6) {
    return hex;
  }

  const fromRed = Number.parseInt(normalized.slice(0, 2), 16);
  const fromGreen = Number.parseInt(normalized.slice(2, 4), 16);
  const fromBlue = Number.parseInt(normalized.slice(4, 6), 16);

  const toRed = Number.parseInt(target.slice(0, 2), 16);
  const toGreen = Number.parseInt(target.slice(2, 4), 16);
  const toBlue = Number.parseInt(target.slice(4, 6), 16);

  const red = clampChannel(fromRed + (toRed - fromRed) * amount);
  const green = clampChannel(fromGreen + (toGreen - fromGreen) * amount);
  const blue = clampChannel(fromBlue + (toBlue - fromBlue) * amount);

  return `#${red.toString(16).padStart(2, "0")}${green
    .toString(16)
    .padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

export function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function getSessionAccent(sessionId: string): string {
  return agentPalette[hashString(sessionId) % agentPalette.length] ?? agentPalette[0];
}

export function getSessionAccentSoft(sessionId: string): string {
  return mixHex(getSessionAccent(sessionId), "#fff7ec", 0.68);
}

export function listOrderedDesks(layout: OfficeLayout): DeskAnchor[] {
  return [...layout.desks].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }

    return left.x - right.x;
  });
}

export function createDeskBadgeMap(layout: OfficeLayout): Map<string, string> {
  const orderedDesks = listOrderedDesks(layout);
  const rows = [...new Set(orderedDesks.map((desk) => desk.y))];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const badgeMap = new Map<string, string>();

  for (const rowY of rows) {
    const rowIndex = rows.indexOf(rowY);
    const rowLabel = letters[rowIndex] ?? `R${rowIndex + 1}`;
    const rowDesks = orderedDesks.filter((desk) => desk.y === rowY);

    rowDesks.forEach((desk, columnIndex) => {
      badgeMap.set(desk.id, `${rowLabel}${columnIndex + 1}`);
    });
  }

  return badgeMap;
}

function getOverflowIndex(slotKey: string): number | null {
  if (!slotKey.startsWith(OVERFLOW_PREFIX)) {
    return null;
  }

  const parsedIndex = Number.parseInt(slotKey.slice(OVERFLOW_PREFIX.length), 10);
  return Number.isFinite(parsedIndex) ? parsedIndex : null;
}

function createOverflowKey(index: number): string {
  return `${OVERFLOW_PREFIX}${index}`;
}

function isValidDeskId(layout: OfficeLayout, slotKey: string | undefined): slotKey is string {
  if (!slotKey) {
    return false;
  }

  return layout.desks.some((desk) => desk.id === slotKey);
}

function assignmentsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}

export function reconcileDeskAssignments(
  current: Record<string, string>,
  sessions: AgentSession[],
  layout: OfficeLayout,
): Record<string, string> {
  const orderedDeskIds = listOrderedDesks(layout).map((desk) => desk.id);
  const availableDeskIds = new Set(orderedDeskIds);
  const next: Record<string, string> = {};
  const occupiedDeskIds = new Set<string>();

  for (const session of sessions) {
    if (
      session.seatId &&
      availableDeskIds.has(session.seatId) &&
      !occupiedDeskIds.has(session.seatId)
    ) {
      next[session.sessionId] = session.seatId;
      occupiedDeskIds.add(session.seatId);
    }
  }

  for (const session of sessions) {
    if (next[session.sessionId]) {
      continue;
    }

    const currentSlot = current[session.sessionId];

    if (isValidDeskId(layout, currentSlot) && !occupiedDeskIds.has(currentSlot)) {
      next[session.sessionId] = currentSlot;
      occupiedDeskIds.add(currentSlot);
    }
  }

  const freeDeskIds = orderedDeskIds.filter((deskId) => !occupiedDeskIds.has(deskId));

  for (const session of sessions) {
    if (next[session.sessionId]) {
      continue;
    }

    const nextDeskId = freeDeskIds.shift();

    if (nextDeskId) {
      next[session.sessionId] = nextDeskId;
      occupiedDeskIds.add(nextDeskId);
    }
  }

  const takenOverflowIndices = new Set<number>();

  for (const session of sessions) {
    if (next[session.sessionId]) {
      continue;
    }

    const overflowIndex = getOverflowIndex(current[session.sessionId] ?? "");

    if (overflowIndex === null || takenOverflowIndices.has(overflowIndex)) {
      continue;
    }

    next[session.sessionId] = createOverflowKey(overflowIndex);
    takenOverflowIndices.add(overflowIndex);
  }

  let overflowIndex = 0;

  for (const session of sessions) {
    if (next[session.sessionId]) {
      continue;
    }

    while (takenOverflowIndices.has(overflowIndex)) {
      overflowIndex += 1;
    }

    next[session.sessionId] = createOverflowKey(overflowIndex);
    takenOverflowIndices.add(overflowIndex);
  }

  return assignmentsEqual(current, next) ? current : next;
}

export function isBlockedSession(session: AgentSession, now: number): boolean {
  if (session.state === "error") {
    return true;
  }

  if (session.state === "permission_needed") {
    return true;
  }

  if (session.state !== "waiting_user") {
    return false;
  }

  const updatedAt = Date.parse(session.updatedAt);
  return Number.isFinite(updatedAt) && now - updatedAt >= BLOCKED_WAIT_MS;
}

function isStuckSession(session: AgentSession, now: number): boolean {
  if (!["thinking", "using_tool", "responding"].includes(session.state)) {
    return false;
  }

  const updatedAt = Date.parse(session.updatedAt);
  return Number.isFinite(updatedAt) && now - updatedAt >= BLOCKED_WAIT_MS;
}

function isRecentlyFinishedSession(session: AgentSession, now: number): boolean {
  if (session.state !== "inactive" || session.lastTurnOutcome !== "completed" || !session.lastTurnOutcomeAt) {
    return false;
  }

  const completedAt = Date.parse(session.lastTurnOutcomeAt);
  return Number.isFinite(completedAt) && now - completedAt <= RECENTLY_FINISHED_MS;
}

function isGenericStateActivityLabel(label: string): boolean {
  return label.startsWith("Current state:") || label.startsWith("State ->");
}

function getLatestRelevantErrorDetail(activity: SessionActivityItem[]): string | null {
  const directError = activity.find(
    (item) => item.state === "error" && !isGenericStateActivityLabel(item.label),
  );

  if (directError) {
    return directError.label;
  }

  const fallbackError = activity.find((item) => item.state === "error");
  return fallbackError ? fallbackError.label : null;
}

function getStuckDetail(session: AgentSession): string {
  if (session.currentTool) {
    return `Using ${session.currentTool}`;
  }

  switch (session.state) {
    case "responding":
      return "Responding";
    case "thinking":
      return "Thinking";
    case "using_tool":
      return "Using tool";
    default:
      return "Working";
  }
}

function getMinutesAgo(timestamp: string, now: number): number | null {
  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(1, Math.floor((now - parsed) / 60_000));
}

function getFinishedDetail(timestamp: string, now: number): string {
  const minutesAgo = getMinutesAgo(timestamp, now);
  return `Finished ${minutesAgo ?? 1}m ago`;
}

function getAttentionSortRank(item: AttentionItem): number {
  switch (item.section) {
    case "action_now":
      return item.severity === "critical" ? 0 : 1;
    case "watch_closely":
      return item.severity === "warning" ? 2 : 3;
    case "recently_finished":
      return 4;
  }
}

export function getHeatmapIntensity(session: AgentSession, now: number): number {
  const updatedAt = Date.parse(session.updatedAt);

  if (!Number.isFinite(updatedAt)) {
    return 0;
  }

  const age = Math.max(0, now - updatedAt);

  if (age >= HEATMAP_WINDOW_MS) {
    return 0;
  }

  const progress = 1 - age / HEATMAP_WINDOW_MS;
  return progress * progress;
}

export function buildLiveOfficeSessions(
  sessions: AgentSession[],
  layout: OfficeLayout,
  assignments: Record<string, string>,
  now: number,
): OfficeRenderSession[] {
  const orderedDesks = listOrderedDesks(layout);
  const deskBadgeMap = createDeskBadgeMap(layout);
  const deskById = new Map(orderedDesks.map((desk) => [desk.id, desk]));
  const deskIndexById = new Map(orderedDesks.map((desk, index) => [desk.id, index]));

  return sessions
    .map((session) => {
      const slotKey = assignments[session.sessionId] ?? session.seatId ?? createOverflowKey(0);
      const desk = deskById.get(slotKey) ?? null;
      const overflowIndex = desk ? null : (getOverflowIndex(slotKey) ?? 0);
      const accentColor = getSessionAccent(session.sessionId);
      const overflowOrder = overflowIndex ?? 0;

      return {
        session,
        accentColor,
        accentSoft: getSessionAccentSoft(session.sessionId),
        desk,
        deskBadge: desk ? (deskBadgeMap.get(desk.id) ?? desk.label) : `O${overflowOrder + 1}`,
        isBlocked: isBlockedSession(session, now),
        overflow: !desk,
        overflowIndex,
        slotKey,
        slotOrder: desk
          ? (deskIndexById.get(desk.id) ?? Number.MAX_SAFE_INTEGER)
          : orderedDesks.length + overflowOrder,
        variant: hashString(session.sessionId) % 3,
      } satisfies OfficeRenderSession;
    })
    .sort((left, right) => left.slotOrder - right.slotOrder);
}

export function getOfficeMetrics(sessions: AgentSession[], now: number) {
  return {
    active: sessions.filter((session) => session.state !== "offline").length,
    blocked: sessions.filter((session) => isBlockedSession(session, now)).length,
    thinking: sessions.filter((session) => session.state === "thinking").length,
    tooling: sessions.filter((session) => session.state === "using_tool").length,
    waiting: sessions.filter((session) => session.state === "waiting_user").length,
  };
}

export function getAttentionItems(
  sessions: OfficeRenderSession[],
  activityBySession: Record<string, SessionActivityItem[]>,
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const renderSession of sessions) {
    const { session } = renderSession;
    const activity = activityBySession[session.sessionId] ?? [];

    if (session.state === "error") {
      items.push({
        detail: getLatestRelevantErrorDetail(activity) ?? "Agent error",
        headline: "Needs attention",
        kind: "error",
        occurredAt: session.updatedAt,
        section: "action_now",
        session: renderSession,
        severity: "critical",
      });
      continue;
    }

    if (session.state === "permission_needed") {
      items.push({
        detail: session.pendingApprovalJustification ?? "Needs your approval",
        headline: "Needs approval",
        kind: "needs_approval",
        occurredAt: session.updatedAt,
        section: "action_now",
        session: renderSession,
        severity: "critical",
      });
      continue;
    }

    if (session.state === "waiting_user" && !session.lastUserAnswer) {
      items.push({
        detail: session.lastUserQuestion ?? "Waiting for your response",
        headline: "Needs answer",
        kind: "needs_answer",
        occurredAt: session.updatedAt,
        section: "action_now",
        session: renderSession,
        severity: renderSession.isBlocked ? "critical" : "warning",
      });
      continue;
    }

    if (isStuckSession(session, now)) {
      items.push({
        detail: getStuckDetail(session),
        headline: "No progress in 4m",
        kind: "stuck",
        occurredAt: session.updatedAt,
        section: "watch_closely",
        session: renderSession,
        severity: "warning",
      });
      continue;
    }

    if (session.state === "waiting_user" && session.lastUserAnswer) {
      items.push({
        detail: session.lastUserQuestion ?? "Waiting to resume",
        headline: "Response recorded",
        kind: "response_recorded",
        occurredAt: session.updatedAt,
        section: "watch_closely",
        session: renderSession,
        severity: "info",
      });
      continue;
    }

    if (isRecentlyFinishedSession(session, now)) {
      items.push({
        detail: getFinishedDetail(session.lastTurnOutcomeAt ?? session.updatedAt, now),
        headline: "Finished",
        kind: "finished",
        occurredAt: session.lastTurnOutcomeAt ?? session.updatedAt,
        section: "recently_finished",
        session: renderSession,
        severity: "info",
      });
    }
  }

  return items
    .sort((left, right) => {
      const rankDifference = getAttentionSortRank(left) - getAttentionSortRank(right);

      if (rankDifference !== 0) {
        return rankDifference;
      }

      return right.occurredAt.localeCompare(left.occurredAt);
    });
}
