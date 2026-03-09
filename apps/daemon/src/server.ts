import fastifyStatic from "@fastify/static";
import type { AccountUsageStatus, WrapperEvent } from "@office-codex/core";
import Fastify from "fastify";
import type pino from "pino";
import { z } from "zod";

import { defaultOfficeLayout } from "@office-codex/assets";

import type { PassiveCodexAdapter } from "./codex-adapter.js";
import {
  DEFAULT_HISTORY_LIMIT,
  type DaemonConfig,
  MAX_HISTORY_LIMIT,
  pathExists,
} from "./config.js";
import type { CursorStore } from "./cursor-store.js";
import type { SessionQueryScope, SessionStore } from "./session-store.js";
import type { WrapperEventHandler } from "./wrapper-events.js";

function writeSse(
  response: {
    write(chunk: string): unknown;
  },
  eventName: string,
  data: unknown,
): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

const sessionQuerySchema = z.object({
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY_LIMIT).default(DEFAULT_HISTORY_LIMIT),
  scope: z.enum(["all", "history", "live"]).default("all"),
});

const wrapperEventSchema = z.discriminatedUnion("type", [
  z.object({
    argv: z.array(z.string()),
    cwd: z.string().min(1),
    pid: z.number().int().positive(),
    startedAt: z.string().min(1),
    type: z.literal("launch"),
  }),
  z.object({
    argv: z.array(z.string()),
    cwd: z.string().min(1),
    pid: z.number().int().positive(),
    sessionId: z.string().min(1),
    startedAt: z.string().min(1),
    type: z.literal("identified"),
  }),
  z.object({
    exitCode: z.number().int().nullable(),
    exitedAt: z.string().min(1),
    pid: z.number().int().positive(),
    sessionId: z.string().min(1).optional(),
    type: z.literal("exit"),
  }),
]);

export async function createServer(options: {
  adapter: PassiveCodexAdapter;
  config: DaemonConfig;
  cursorStore: CursorStore;
  getAccountUsage(): Promise<AccountUsageStatus>;
  logger: pino.Logger;
  startedAt: number;
  store: SessionStore;
  codexHome: string;
  webDistDir: string;
  wrapperEvents: WrapperEventHandler;
}) {
  const app = Fastify({
    loggerInstance: options.logger,
  });

  app.get("/api/health", async () => {
    const meta = options.store.getQueryMeta({
      limit: options.config.offlineHistoryCap,
    });

    return {
      ok: true,
      codexHome: options.codexHome,
      runtime: {
        node: process.version,
        pid: process.pid,
        uptimeSec: Math.round((Date.now() - options.startedAt) / 1000),
      },
      sessions: {
        historyCap: meta.historyCap,
        live: meta.liveCount,
        offline: meta.offlineCount,
        tracked: meta.trackedCount,
      },
      adapter: options.adapter.getMetrics(),
      cursorStore: options.cursorStore.getDiagnostics(),
      account: await options.getAccountUsage(),
      wrapperHints: options.wrapperEvents.getDiagnostics(),
    };
  });

  app.get("/api/sessions", async (request, reply) => {
    const parsed = sessionQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid session query",
      });
    }

    const query = parsed.data as {
      before?: string;
      limit: number;
      scope: SessionQueryScope;
    };
    const result = options.store.query(query);

    return {
      meta: result.meta,
      sessions: result.sessions,
    };
  });

  app.get("/api/account", async () => ({
    account: await options.getAccountUsage(),
  }));

  app.get("/api/layout", async () => ({
    layout: defaultOfficeLayout,
  }));

  app.get("/api/events", async (request, reply) => {
    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");

    reply.raw.write("retry: 1000\n\n");
    writeSse(
      reply.raw,
      "snapshot",
      options.store.query({ limit: DEFAULT_HISTORY_LIMIT, scope: "all" }),
    );

    const unsubscribe = options.store.subscribe((event) => {
      writeSse(reply.raw, event.type, {
        event,
        session: options.store.get(event.sessionId) ?? null,
      });
    });

    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });

  app.post("/api/internal/wrapper-events", async (request, reply) => {
    const parsed = wrapperEventSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid wrapper event",
      });
    }

    options.wrapperEvents.apply(parsed.data as WrapperEvent);
    return reply.code(202).send({
      ok: true,
    });
  });

  const hasStatic = await pathExists(options.webDistDir);

  app.get("/__static-ready", async () => ({
    staticDir: options.webDistDir,
    hasStatic,
  }));

  if (!hasStatic) {
    app.get("/", async () => ({
      name: "office-codex-daemon",
      status: "ok",
    }));
    return app;
  }

  await app.register(fastifyStatic, {
    prefix: "/",
    root: options.webDistDir,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api")) {
      return reply.code(404).send({
        error: "Not found",
      });
    }

    return reply.sendFile("index.html");
  });

  return app;
}
