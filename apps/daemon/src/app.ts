import { fileURLToPath } from "node:url";

import pino from "pino";

import { startPassiveCodexAdapter } from "./codex-adapter.js";
import { type DaemonConfig, getCursorStorePath, resolveDaemonConfig } from "./config.js";
import { CursorStore } from "./cursor-store.js";
import { createServer } from "./server.js";
import { SessionStore } from "./session-store.js";

export interface StartedDaemon {
  close(): Promise<void>;
  config: DaemonConfig;
  store: SessionStore;
}

export async function startDaemon(overrides: Partial<DaemonConfig> = {}): Promise<StartedDaemon> {
  const config = resolveDaemonConfig(overrides);
  const logger = pino({
    name: "office-codex-daemon",
    level: process.env.LOG_LEVEL ?? "info",
  });
  const store = new SessionStore();
  const cursorStore = new CursorStore(getCursorStorePath(config));
  await cursorStore.load();
  const adapter = await startPassiveCodexAdapter({
    config,
    store,
    cursorStore,
    logger,
  });
  const webDistDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const server = await createServer({
    logger,
    store,
    codexHome: config.codexHome,
    webDistDir,
  });

  await server.listen({
    host: "127.0.0.1",
    port: config.port,
  });

  logger.info({ port: config.port }, "Office Codex daemon listening");

  return {
    config,
    store,
    async close() {
      await adapter.close();
      await server.close();
    },
  };
}

export { DEFAULT_PORT, DEFAULT_WEB_PORT, pathExists, resolveDaemonConfig } from "./config.js";
