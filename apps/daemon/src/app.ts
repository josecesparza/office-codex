import { fileURLToPath } from "node:url";

import pino from "pino";

import { AccountUsageService } from "./account-usage.js";
import { startPassiveCodexAdapter } from "./codex-adapter.js";
import {
  type DaemonConfig,
  getCursorStorePath,
  pathExists,
  resolveDaemonConfig,
} from "./config.js";
import { CursorStore } from "./cursor-store.js";
import { createServer } from "./server.js";
import { SessionStore } from "./session-store.js";
import { WrapperEventHandler } from "./wrapper-events.js";

export interface StartedDaemon {
  close(): Promise<void>;
  config: DaemonConfig;
  store: SessionStore;
}

export async function startDaemon(overrides: Partial<DaemonConfig> = {}): Promise<StartedDaemon> {
  const startedAt = Date.now();
  const config = resolveDaemonConfig(overrides);
  const logger = pino({
    name: "office-codex-daemon",
    level: process.env.LOG_LEVEL ?? "info",
  });
  const store = new SessionStore({
    offlineHistoryCap: config.offlineHistoryCap,
  });
  const cursorStore = new CursorStore(getCursorStorePath(config), config.cursorFlushMs);
  await cursorStore.load();
  const adapter = await startPassiveCodexAdapter({
    config,
    store,
    cursorStore,
    logger,
  });
  const wrapperEvents = new WrapperEventHandler(store, config.wrapperHintTtlMs);
  const accountUsage = new AccountUsageService({
    chatGptOrigin: config.chatGptOrigin,
    codexHome: config.codexHome,
    logger,
    refreshMs: config.accountRefreshMs,
  });
  await accountUsage.start();
  const webDistDir = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const server = await createServer({
    adapter,
    accountUsage,
    config,
    cursorStore,
    logger,
    store,
    codexHome: config.codexHome,
    startedAt,
    webDistDir,
    wrapperEvents,
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
      await accountUsage.close();
      await server.close();
    },
  };
}

export { findLatestStateDb } from "./codex-adapter.js";
export { DEFAULT_PORT, DEFAULT_WEB_PORT, pathExists, resolveDaemonConfig } from "./config.js";
