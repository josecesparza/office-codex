import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { officePalette } from "@office-codex/assets";
import type { DeskAnchor, OfficeLayout } from "@office-codex/core";

import {
  type OfficeRenderSession,
  type SessionGeometry,
  createDeskBadgeMap,
  getHeatmapIntensity,
  hashString,
} from "../lib/office-ui";

interface OfficeCanvasProps {
  hoveredSessionId?: string | null;
  lastMutationAt: number;
  layout: OfficeLayout;
  onHoveredSessionChange?: (sessionId: string | null) => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
  onSessionGeometryChange?: (geometries: Record<string, SessionGeometry>) => void;
  reducedMotion?: boolean;
  selectedSessionId?: string | null;
  sessions: OfficeRenderSession[];
}

interface AgentSlot {
  overflow: boolean;
  renderSession: OfficeRenderSession;
  x: number;
  y: number;
}

interface AgentAnimationState {
  badgePulse: number;
  blinkClosed: boolean;
  bodyOffsetY: number;
  headOffsetX: number;
  headOffsetY: number;
  talkPulse: number;
  toolPulse: number;
}

const SCALE = 4;
const ACTIVE_FPS = 20;
const IDLE_FPS = 4;

function resolveSlots(layout: OfficeLayout, sessions: OfficeRenderSession[]): AgentSlot[] {
  return sessions.map((renderSession) => {
    if (renderSession.desk) {
      return {
        overflow: false,
        renderSession,
        x: renderSession.desk.x * layout.tileSize,
        y: renderSession.desk.y * layout.tileSize,
      };
    }

    const overflowIndex = renderSession.overflowIndex ?? 0;
    const column = overflowIndex % 6;
    const row = Math.floor(overflowIndex / 6);

    return {
      overflow: true,
      renderSession,
      x: (1 + column * 2) * layout.tileSize,
      y: (layout.height - 1 + row) * layout.tileSize,
    };
  });
}

function getCanvasRows(layout: OfficeLayout, sessions: OfficeRenderSession[]): number {
  const overflowCount = sessions.filter((session) => session.overflow).length;
  return layout.height + Math.ceil(overflowCount / 6);
}

function getHoveredSessionId(slots: AgentSlot[], x: number, y: number): string | null {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const slot = slots[index];

    if (!slot) {
      continue;
    }

    const agentX = slot.x + 8;
    const agentY = slot.y - 4;

    if (x >= agentX - 3 && x <= agentX + 15 && y >= agentY && y <= agentY + 24) {
      return slot.renderSession.session.sessionId;
    }
  }

  return null;
}

function measureSessionGeometries(
  canvas: HTMLCanvasElement,
  slots: AgentSlot[],
): Record<string, SessionGeometry> {
  const parent = canvas.parentElement;

  if (!parent || canvas.width === 0 || canvas.height === 0) {
    return {};
  }

  const canvasRect = canvas.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const scaleX = canvasRect.width / canvas.width;
  const scaleY = canvasRect.height / canvas.height;
  const geometries: Record<string, SessionGeometry> = {};

  for (const slot of slots) {
    const deskBounds = {
      height: 16 * scaleY,
      width: 26 * scaleX,
      x: canvasRect.left - parentRect.left + (slot.x - 2) * scaleX,
      y: canvasRect.top - parentRect.top + (slot.y + 1) * scaleY,
    };
    const agentBounds = {
      height: 24 * scaleY,
      width: 18 * scaleX,
      x: canvasRect.left - parentRect.left + (slot.x + 5) * scaleX,
      y: canvasRect.top - parentRect.top + (slot.y - 4) * scaleY,
    };

    geometries[slot.renderSession.session.sessionId] = {
      agentBounds,
      agentCenter: {
        x: agentBounds.x + agentBounds.width / 2,
        y: agentBounds.y + agentBounds.height / 2,
      },
      deskBounds,
      deskCenter: {
        x: deskBounds.x + deskBounds.width / 2,
        y: deskBounds.y + deskBounds.height / 2,
      },
    };
  }

  return geometries;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  totalRows: number,
): void {
  const width = layout.width * layout.tileSize;
  const height = totalRows * layout.tileSize;

  ctx.fillStyle = officePalette.background;
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < totalRows; row += 1) {
    for (let column = 0; column < layout.width; column += 1) {
      ctx.fillStyle = (row + column) % 2 === 0 ? officePalette.floor : officePalette.overflow;
      ctx.fillRect(
        column * layout.tileSize,
        row * layout.tileSize,
        layout.tileSize,
        layout.tileSize,
      );
    }
  }

  ctx.strokeStyle = officePalette.wall;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
}

function drawDeskHeatmap(
  ctx: CanvasRenderingContext2D,
  slot: AgentSlot,
  intensity: number,
  color: string,
): void {
  if (intensity <= 0) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = Math.min(0.28, intensity * 0.24);
  ctx.fillStyle = color;
  ctx.fillRect(slot.x - 8, slot.y + 10, 34, 10);
  ctx.globalAlpha = Math.min(0.18, intensity * 0.14);
  ctx.fillRect(slot.x - 12, slot.y + 6, 42, 18);
  ctx.restore();
}

function drawDeskLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  badge: string,
  accentColor: string | null,
): void {
  ctx.fillStyle = accentColor ? accentColor : "#f6e5ba";
  ctx.fillRect(x + 1, y + 14, 14, 6);
  ctx.fillStyle = officePalette.wall;
  ctx.fillRect(x + 2, y + 15, 12, 4);
  ctx.fillStyle = accentColor ? "#fff7ec" : "#fef3c7";
  ctx.font = "5px Menlo, monospace";
  ctx.fillText(badge, x + 3, y + 18.5);
}

function drawDeskHalo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  style: "selected" | "focused" | "blocked",
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = style === "selected" ? 2 : 1;
  ctx.strokeRect(x - 4.5, y - 1.5, 30, 17);

  if (style === "selected") {
    ctx.fillStyle = color;
    ctx.fillRect(x - 6, y + 14, 34, 2);
  }

  if (style === "blocked") {
    ctx.fillStyle = color;
    ctx.fillRect(x + 10, y - 4, 4, 4);
  }

  ctx.restore();
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  desk: DeskAnchor,
  badge: string,
  options: {
    accentColor: string | null;
    badgePulse: number;
    isBlocked: boolean;
    isFocused: boolean;
    isSelected: boolean;
    isTooling: boolean;
  },
): void {
  const x = desk.x * layout.tileSize;
  const y = desk.y * layout.tileSize;
  const size = layout.tileSize;

  if (options.isBlocked) {
    drawDeskHalo(ctx, x, y + 2, "#dc2626", "blocked");
  } else if (options.isSelected) {
    drawDeskHalo(ctx, x, y + 2, options.accentColor ?? officePalette.accent, "selected");
  } else if (options.isFocused) {
    drawDeskHalo(ctx, x, y + 2, options.accentColor ?? officePalette.accent, "focused");
  }

  ctx.fillStyle = officePalette.deskShadow;
  ctx.fillRect(x + 2, y + 9, size + 10, 5);
  ctx.fillStyle = officePalette.desk;
  ctx.fillRect(x, y + 2, size + 10, 10);

  if (options.isTooling && options.accentColor) {
    ctx.save();
    ctx.globalAlpha = 0.2 + options.badgePulse * 0.12;
    ctx.fillStyle = options.accentColor;
    ctx.fillRect(x + 3, y + 4, size - 2, 3);
    ctx.restore();
  }

  ctx.fillStyle = officePalette.wall;
  ctx.fillRect(x + 3, y + 4, size - 2, 2);
  drawDeskLabel(ctx, x, y, badge, options.accentColor);
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  pulse: number,
): void {
  const size = 7 + Math.round(pulse * 1.5);

  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 2, y + 2, Math.max(3, size - 4), Math.max(3, size - 4));
}

function drawFocusedAgentAccent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  selected: boolean,
): void {
  ctx.fillStyle = "#fff7c2";
  ctx.fillRect(x + 1, y + 1, 10, 1);
  ctx.fillRect(x + 1, y + 10, 10, 1);
  ctx.fillRect(x + 1, y + 2, 1, 8);
  ctx.fillRect(x + 10, y + 2, 1, 8);

  ctx.fillRect(x - 1, y + 7, 14, 1);
  ctx.fillRect(x - 1, y + 20, 14, 1);
  ctx.fillRect(x - 1, y + 8, 1, 12);
  ctx.fillRect(x + 12, y + 8, 1, 12);

  ctx.fillStyle = color;
  ctx.fillRect(x - 3, y + 3, 2, 2);
  ctx.fillRect(x + 13, y + 3, 2, 2);
  ctx.fillRect(x - 3, y + 17, 2, 2);
  ctx.fillRect(x + 13, y + 17, 2, 2);

  if (selected) {
    ctx.fillRect(x - 5, y + 22, 22, 3);
    ctx.fillStyle = "#fff3a8";
    ctx.fillRect(x - 2, y + 23, 16, 1);
    return;
  }

  ctx.fillStyle = "#fff3a8";
  ctx.fillRect(x - 4, y + 22, 20, 2);
}

function getAnimationState(
  slot: AgentSlot,
  now: number,
  motionEnabled: boolean,
): AgentAnimationState {
  const phase = (hashString(slot.renderSession.session.sessionId) % 997) / 997;
  const movement = motionEnabled ? Math.sin(now / 420 + phase * Math.PI * 2) : 0;
  const drift = motionEnabled ? Math.sin(now / 860 + phase * Math.PI * 2) : 0;
  const badgePulse = motionEnabled ? (Math.sin(now / 320 + phase * Math.PI * 2) + 1) / 2 : 0.2;
  const blinkClosed = motionEnabled ? (now + phase * 4700) % 4700 < 120 : false;

  return {
    badgePulse,
    blinkClosed,
    bodyOffsetY: Math.round(drift * (slot.renderSession.session.state === "offline" ? 0 : 1)),
    headOffsetX:
      slot.renderSession.session.state === "thinking" && motionEnabled ? Math.round(movement) : 0,
    headOffsetY:
      slot.renderSession.session.state === "thinking" && motionEnabled
        ? Math.round((drift + 1) * 0.6)
        : Math.round(drift * 0.5),
    talkPulse:
      slot.renderSession.session.state === "responding" && motionEnabled ? badgePulse + 0.2 : 0,
    toolPulse: slot.renderSession.session.state === "using_tool" && motionEnabled ? badgePulse : 0,
  };
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  slot: AgentSlot,
  options: {
    hasFocusedSession: boolean;
    isFocused: boolean;
    isSelected: boolean;
    motionEnabled: boolean;
    now: number;
  },
): void {
  const { accentColor, isBlocked, session, variant } = slot.renderSession;
  const animation = getAnimationState(slot, options.now, options.motionEnabled);
  const x = slot.x + 8;
  const y = slot.y - 4 + animation.bodyOffsetY;
  const headX = x + animation.headOffsetX;
  const headY = y + 2 + animation.headOffsetY;
  const bodyWidth = variant === 1 ? 10 : 12;

  ctx.save();
  const baseAlpha = session.state === "offline" ? 0.38 : 1;
  ctx.globalAlpha = options.hasFocusedSession && !options.isFocused ? baseAlpha * 0.52 : baseAlpha;

  if (options.isFocused) {
    drawFocusedAgentAccent(ctx, x, y, accentColor, options.isSelected);
  }

  ctx.fillStyle = accentColor;
  ctx.fillRect(x + Math.max(0, (12 - bodyWidth) / 2), y + 8, bodyWidth, 12);
  ctx.fillRect(headX + 2, headY, 8, 8);
  ctx.fillStyle = officePalette.wall;

  if (animation.blinkClosed) {
    ctx.fillRect(headX + 3, headY + 4, 2, 1);
    ctx.fillRect(headX + 7, headY + 4, 2, 1);
  } else {
    ctx.fillRect(headX + 3, headY + 3, 2, 2);
    ctx.fillRect(headX + 7, headY + 3, 2, 2);
  }

  if (session.state === "thinking") {
    drawBadge(ctx, x + 14, y - 2, "#1d4ed8", animation.badgePulse);
  }

  if (session.state === "using_tool") {
    ctx.fillStyle = officePalette.accent;
    ctx.fillRect(x + 1, y + 18, 10, 2);
    ctx.fillRect(x + 12, y + 18, 4 + Math.round(animation.toolPulse), 2);
  }

  if (session.state === "responding") {
    drawBadge(ctx, x + 14, y - 2, "#f3f4f6", animation.badgePulse);
    if (animation.talkPulse > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18 + animation.talkPulse * 0.2;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 15, y + 6, 8, 6);
      ctx.fillRect(x + 13, y + 10, 4, 2);
      ctx.restore();
    }
  }

  if (session.state === "waiting_user") {
    drawBadge(ctx, x + 14, y - 2, "#f97316", animation.badgePulse);
  }

  if (session.state === "error") {
    drawBadge(ctx, x + 14, y - 2, "#dc2626", animation.badgePulse);
  }

  if (isBlocked) {
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(x + 4, y - 4, 4, 2);
  }

  if (session.activeSubtasks > 0) {
    for (let badgeIndex = 0; badgeIndex < Math.min(session.activeSubtasks, 3); badgeIndex += 1) {
      ctx.fillStyle = "#111827";
      ctx.fillRect(x - 6 - badgeIndex * 4, y + 14, 3, 3);
    }
  }

  if (slot.overflow) {
    ctx.strokeStyle = officePalette.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 4, y + 20, 20, 4);
  }

  ctx.restore();
}

export function OfficeCanvas(props: OfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const slots = useMemo(
    () => resolveSlots(props.layout, props.sessions),
    [props.layout, props.sessions],
  );
  const totalRows = useMemo(
    () => getCanvasRows(props.layout, props.sessions),
    [props.layout, props.sessions],
  );
  const focusedSessionId =
    props.selectedSessionId ?? (!props.selectedSessionId ? props.hoveredSessionId : null);
  const hasFocusedSession = useMemo(
    () =>
      Boolean(
        focusedSessionId &&
          props.sessions.some(
            (renderSession) => renderSession.session.sessionId === focusedSessionId,
          ),
      ),
    [focusedSessionId, props.sessions],
  );
  const deskBadgeMap = useMemo(() => createDeskBadgeMap(props.layout), [props.layout]);
  const motionEnabled = !prefersReducedMotion && !props.reducedMotion;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updatePreference = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);

    return () => {
      mediaQuery.removeEventListener("change", updatePreference);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const onSessionGeometryChange = props.onSessionGeometryChange;

    if (!canvas || !onSessionGeometryChange) {
      return;
    }

    const reportGeometries = () => {
      onSessionGeometryChange(measureSessionGeometries(canvas, slots));
    };

    const frameId = window.requestAnimationFrame(reportGeometries);

    const observer = new ResizeObserver(reportGeometries);
    observer.observe(canvas);

    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }

    window.addEventListener("resize", reportGeometries);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", reportGeometries);
    };
  }, [props.onSessionGeometryChange, slots]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    const width = props.layout.width * props.layout.tileSize;
    const height = totalRows * props.layout.tileSize;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width * SCALE}px`;
    canvas.style.height = "auto";
    canvas.style.maxWidth = "100%";

    let frameId = 0;
    let geometryFrameId = 0;
    let lastFrame = 0;

    const draw = (now: number) => {
      const realNow = Date.now();
      ctx.imageSmoothingEnabled = false;
      drawBackground(ctx, props.layout, totalRows);

      for (const slot of slots) {
        if (!slot.renderSession.desk) {
          continue;
        }

        drawDeskHeatmap(
          ctx,
          slot,
          getHeatmapIntensity(slot.renderSession.session, realNow),
          slot.renderSession.accentColor,
        );
      }

      for (const desk of props.layout.desks) {
        const occupant =
          props.sessions.find((renderSession) => renderSession.desk?.id === desk.id) ?? null;
        const occupantSessionId = occupant?.session.sessionId ?? null;
        const isSelected = occupantSessionId === props.selectedSessionId;
        const isFocused = occupantSessionId === focusedSessionId;

        drawDesk(ctx, props.layout, desk, deskBadgeMap.get(desk.id) ?? desk.label, {
          accentColor: occupant?.accentColor ?? null,
          badgePulse:
            occupant?.session.state === "using_tool" || occupant?.session.state === "thinking"
              ? getAnimationState(
                  {
                    overflow: false,
                    renderSession: occupant,
                    x: desk.x * props.layout.tileSize,
                    y: desk.y * props.layout.tileSize,
                  },
                  now,
                  motionEnabled,
                ).badgePulse
              : 0,
          isBlocked: occupant?.isBlocked ?? false,
          isFocused,
          isSelected,
          isTooling: occupant?.session.state === "using_tool",
        });
      }

      for (const slot of slots) {
        drawAgent(ctx, slot, {
          hasFocusedSession,
          isFocused: slot.renderSession.session.sessionId === focusedSessionId,
          isSelected: slot.renderSession.session.sessionId === props.selectedSessionId,
          motionEnabled,
          now,
        });
      }
    };

    const tick = (now: number) => {
      const isIdle = Date.now() - props.lastMutationAt > 10_000;
      const targetFps = isIdle ? IDLE_FPS : ACTIVE_FPS;
      const frameInterval = 1000 / targetFps;

      if (!document.hidden && now - lastFrame >= frameInterval) {
        draw(now);
        lastFrame = now;
      }

      frameId = window.requestAnimationFrame(tick);
    };

    draw(performance.now());
    geometryFrameId = window.requestAnimationFrame(() => {
      props.onSessionGeometryChange?.(measureSessionGeometries(canvas, slots));
    });
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(geometryFrameId);
    };
  }, [
    deskBadgeMap,
    focusedSessionId,
    hasFocusedSession,
    motionEnabled,
    props.lastMutationAt,
    props.layout,
    props.onSessionGeometryChange,
    props.selectedSessionId,
    props.sessions,
    slots,
    totalRows,
  ]);

  const resolveSessionFromPointer = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return null;
      }

      const bounds = canvas.getBoundingClientRect();
      const scaleX = canvas.width / bounds.width;
      const scaleY = canvas.height / bounds.height;

      return getHoveredSessionId(
        slots,
        (event.clientX - bounds.left) * scaleX,
        (event.clientY - bounds.top) * scaleY,
      );
    },
    [slots],
  );

  const handleMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const hoveredSessionId = resolveSessionFromPointer(event);

    event.currentTarget.style.cursor = hoveredSessionId ? "pointer" : "default";
    props.onHoveredSessionChange?.(hoveredSessionId);
  };

  const handleMouseLeave = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.currentTarget.style.cursor = "default";
    props.onHoveredSessionChange?.(null);
  };

  const handleMouseUp = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const clickedSessionId = resolveSessionFromPointer(event);
    props.onSelectedSessionChange?.(clickedSessionId);
  };

  return (
    <canvas
      className="office-canvas"
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      ref={canvasRef}
    />
  );
}
