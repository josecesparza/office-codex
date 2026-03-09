import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type pino from "pino";

import { defaultOfficeLayout } from "@office-codex/assets";

import { pathExists } from "./config.js";
import type { SessionStore } from "./session-store.js";

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

export async function createServer(options: {
  logger: pino.Logger;
  store: SessionStore;
  codexHome: string;
  webDistDir: string;
}) {
  const app = Fastify({
    loggerInstance: options.logger,
  });

  app.get("/api/health", async () => ({
    ok: true,
    codexHome: options.codexHome,
    sessions: options.store.list().length,
  }));

  app.get("/api/sessions", async () => ({
    sessions: options.store.list(),
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
    writeSse(reply.raw, "snapshot", {
      sessions: options.store.list(),
    });

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
    root: options.webDistDir,
    prefix: "/",
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
