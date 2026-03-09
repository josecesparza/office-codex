import { useEffect, useMemo, useRef } from "react";

import { agentPalette, defaultOfficeLayout, officePalette } from "@office-codex/assets";
import type { AgentSession, DeskAnchor, OfficeLayout } from "@office-codex/core";

interface OfficeCanvasProps {
  layout: OfficeLayout | null;
  sessions: AgentSession[];
  lastMutationAt: number;
}

interface AgentSlot {
  session: AgentSession;
  x: number;
  y: number;
  overflow: boolean;
}

const SCALE = 4;
const ACTIVE_FPS = 20;
const IDLE_FPS = 4;

function resolveDesk(
  session: AgentSession,
  layout: OfficeLayout,
  index: number,
): DeskAnchor | null {
  if (session.seatId) {
    const exactDesk = layout.desks.find((desk) => desk.id === session.seatId);
    if (exactDesk) {
      return exactDesk;
    }
  }

  return layout.desks[index] ?? null;
}

function resolveSlots(layout: OfficeLayout, sessions: AgentSession[]): AgentSlot[] {
  return sessions.map((session, index) => {
    const desk = resolveDesk(session, layout, index);

    if (desk) {
      return {
        session,
        x: desk.x * layout.tileSize,
        y: desk.y * layout.tileSize,
        overflow: false,
      };
    }

    const overflowIndex = index - layout.desks.length;
    const column = overflowIndex % 6;
    const row = Math.floor(overflowIndex / 6);

    return {
      session,
      x: (1 + column * 2) * layout.tileSize,
      y: (layout.height - 1 + row) * layout.tileSize,
      overflow: true,
    };
  });
}

function drawBackground(ctx: CanvasRenderingContext2D, layout: OfficeLayout): void {
  const width = layout.width * layout.tileSize;
  const height = layout.height * layout.tileSize;

  ctx.fillStyle = officePalette.background;
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < layout.height; row += 1) {
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

function drawDesk(ctx: CanvasRenderingContext2D, layout: OfficeLayout, desk: DeskAnchor): void {
  const x = desk.x * layout.tileSize;
  const y = desk.y * layout.tileSize;
  const size = layout.tileSize;

  ctx.fillStyle = officePalette.deskShadow;
  ctx.fillRect(x + 2, y + 9, size + 10, 5);
  ctx.fillStyle = officePalette.desk;
  ctx.fillRect(x, y + 2, size + 10, 10);
  ctx.fillStyle = officePalette.wall;
  ctx.fillRect(x + 3, y + 4, size - 2, 2);
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 8, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 2, y + 2, 4, 4);
}

function drawAgent(ctx: CanvasRenderingContext2D, slot: AgentSlot, index: number): void {
  const color = agentPalette[index % agentPalette.length] ?? officePalette.accent;
  const x = slot.x + 8;
  const y = slot.y - 4;

  ctx.save();
  ctx.globalAlpha = slot.session.state === "offline" ? 0.38 : 1;

  ctx.fillStyle = color;
  ctx.fillRect(x, y + 8, 12, 12);
  ctx.fillRect(x + 2, y + 2, 8, 8);
  ctx.fillStyle = officePalette.wall;
  ctx.fillRect(x + 3, y + 4, 2, 2);
  ctx.fillRect(x + 7, y + 4, 2, 2);

  if (slot.session.state === "thinking") {
    drawBadge(ctx, x + 14, y - 2, "#1d4ed8");
  }

  if (slot.session.state === "using_tool") {
    ctx.fillStyle = officePalette.accent;
    ctx.fillRect(x + 1, y + 18, 10, 2);
    ctx.fillRect(x + 12, y + 18, 4, 2);
  }

  if (slot.session.state === "responding") {
    drawBadge(ctx, x + 14, y - 2, "#f3f4f6");
  }

  if (slot.session.state === "waiting_user") {
    drawBadge(ctx, x + 14, y - 2, "#f97316");
  }

  if (slot.session.state === "error") {
    drawBadge(ctx, x + 14, y - 2, "#dc2626");
  }

  if (slot.session.activeSubtasks > 0) {
    for (
      let badgeIndex = 0;
      badgeIndex < Math.min(slot.session.activeSubtasks, 3);
      badgeIndex += 1
    ) {
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
  const effectiveLayout = props.layout ?? defaultOfficeLayout;
  const slots = useMemo(
    () => resolveSlots(effectiveLayout, props.sessions),
    [effectiveLayout, props.sessions],
  );

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    const width = effectiveLayout.width * effectiveLayout.tileSize;
    const height = Math.max(
      effectiveLayout.height * effectiveLayout.tileSize,
      (effectiveLayout.height +
        Math.max(0, Math.ceil((props.sessions.length - effectiveLayout.desks.length) / 6))) *
        effectiveLayout.tileSize,
    );

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width * SCALE}px`;
    canvas.style.height = `${height * SCALE}px`;

    let frameId = 0;
    let lastFrame = 0;

    const draw = () => {
      ctx.imageSmoothingEnabled = false;
      drawBackground(ctx, effectiveLayout);

      for (const desk of effectiveLayout.desks) {
        drawDesk(ctx, effectiveLayout, desk);
      }

      for (const [index, slot] of slots.entries()) {
        drawAgent(ctx, slot, index);
      }
    };

    const tick = (now: number) => {
      const isIdle = Date.now() - props.lastMutationAt > 10_000;
      const targetFps = isIdle ? IDLE_FPS : ACTIVE_FPS;
      const frameInterval = 1000 / targetFps;

      if (!document.hidden && now - lastFrame >= frameInterval) {
        draw();
        lastFrame = now;
      }

      frameId = window.requestAnimationFrame(tick);
    };

    draw();
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [effectiveLayout, props.lastMutationAt, props.sessions.length, slots]);

  return <canvas className="office-canvas" ref={canvasRef} />;
}
