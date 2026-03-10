import { agentPalette } from "@office-codex/assets";
import type { AgentSession, DeskAnchor, OfficeLayout } from "@office-codex/core";

const OVERFLOW_PREFIX = "overflow:";

export const BLOCKED_WAIT_MS = 180_000;
export const HEATMAP_WINDOW_MS = 300_000;

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
  reason: string;
  detail?: string;
  response?: string;
  session: OfficeRenderSession;
  severity: "critical" | "warning";
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
  now: number,
  limit = 4,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const renderSession of sessions) {
    if (renderSession.session.state === "error") {
      items.push({
        reason: "Agent error",
        session: renderSession,
        severity: "critical",
      });
      continue;
    }

    if (renderSession.session.state === "permission_needed") {
      items.push({
        reason: renderSession.session.pendingApprovalJustification ?? "Permission needed",
        session: renderSession,
        severity: "critical",
      });
      continue;
    }

    if (renderSession.session.state === "waiting_user") {
      const blockedMinutes = Math.floor(
        (now - Date.parse(renderSession.session.updatedAt)) / 60000,
      );
      const question = renderSession.session.lastUserQuestion;
      const response = renderSession.session.lastUserAnswer;
      const detail = renderSession.isBlocked
        ? response
          ? `Waiting ${blockedMinutes}m after reply`
          : `Waiting ${blockedMinutes}m`
        : response
          ? "Response recorded"
          : "Awaiting response";

      items.push({
        ...(question ? { detail } : {}),
        ...(response ? { response } : {}),
        reason: question ?? detail,
        session: renderSession,
        severity: "warning",
      });
    }
  }

  return items
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === "critical" ? -1 : 1;
      }

      return right.session.session.updatedAt.localeCompare(left.session.session.updatedAt);
    })
    .slice(0, limit);
}
