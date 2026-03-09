import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import envPaths from "env-paths";

export const DEFAULT_PORT = 3210;
export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_IDLE_MS = 120_000;
export const DEFAULT_BOOTSTRAP_SEED_LIMIT = 500;
export const DEFAULT_OFFLINE_HISTORY_CAP = 200;
export const DEFAULT_CURSOR_FLUSH_MS = 500;
export const DEFAULT_WRAPPER_HINT_TTL_MS = 120_000;
export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;
export const DEFAULT_TITLE_HYDRATION_MODE = "first_user_message";
export const DEFAULT_CHATGPT_ORIGIN = "https://chatgpt.com";
export const DEFAULT_ACCOUNT_REFRESH_MS = 60_000;

export type TitleHydrationMode = "metadata" | "first_user_message";

export interface DaemonConfig {
  accountRefreshMs: number;
  port: number;
  chatGptOrigin: string;
  codexHome: string;
  dataDir: string;
  idleMs: number;
  bootstrapSeedLimit: number;
  offlineHistoryCap: number;
  cursorFlushMs: number;
  titleHydrationMode: TitleHydrationMode;
  wrapperHintTtlMs: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTitleHydrationMode(value: string | undefined): TitleHydrationMode {
  return value === "metadata" ? "metadata" : DEFAULT_TITLE_HYDRATION_MODE;
}

function parseOrigin(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveDaemonConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const paths = envPaths("office-codex", { suffix: "" });
  const codexHome = resolve(process.env.OFFICE_CODEX_CODEX_HOME ?? join(homedir(), ".codex"));
  const dataDir = process.env.OFFICE_CODEX_DATA_DIR ?? paths.data;

  return {
    accountRefreshMs:
      overrides.accountRefreshMs ??
      parseNumber(process.env.OFFICE_CODEX_ACCOUNT_REFRESH_MS, DEFAULT_ACCOUNT_REFRESH_MS),
    port: overrides.port ?? parseNumber(process.env.OFFICE_CODEX_PORT, DEFAULT_PORT),
    chatGptOrigin:
      overrides.chatGptOrigin ??
      parseOrigin(process.env.OFFICE_CODEX_CHATGPT_ORIGIN, DEFAULT_CHATGPT_ORIGIN),
    codexHome: overrides.codexHome ?? codexHome,
    dataDir: overrides.dataDir ?? dataDir,
    bootstrapSeedLimit:
      overrides.bootstrapSeedLimit ??
      parseNumber(process.env.OFFICE_CODEX_BOOTSTRAP_SEED_LIMIT, DEFAULT_BOOTSTRAP_SEED_LIMIT),
    cursorFlushMs:
      overrides.cursorFlushMs ??
      parseNumber(process.env.OFFICE_CODEX_CURSOR_FLUSH_MS, DEFAULT_CURSOR_FLUSH_MS),
    idleMs: overrides.idleMs ?? parseNumber(process.env.OFFICE_CODEX_IDLE_MS, DEFAULT_IDLE_MS),
    offlineHistoryCap:
      overrides.offlineHistoryCap ??
      parseNumber(process.env.OFFICE_CODEX_HISTORY_CAP, DEFAULT_OFFLINE_HISTORY_CAP),
    titleHydrationMode:
      overrides.titleHydrationMode ??
      parseTitleHydrationMode(process.env.OFFICE_CODEX_TITLE_HYDRATION_MODE),
    wrapperHintTtlMs:
      overrides.wrapperHintTtlMs ??
      parseNumber(process.env.OFFICE_CODEX_WRAPPER_HINT_TTL_MS, DEFAULT_WRAPPER_HINT_TTL_MS),
  };
}

export function getCursorStorePath(config: DaemonConfig): string {
  return join(config.dataDir, "cursors.json");
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
