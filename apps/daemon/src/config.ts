import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import envPaths from "env-paths";

export const DEFAULT_PORT = 3210;
export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_IDLE_MS = 120_000;

export interface DaemonConfig {
  port: number;
  codexHome: string;
  dataDir: string;
  idleMs: number;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveDaemonConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const paths = envPaths("office-codex", { suffix: "" });
  const codexHome = resolve(process.env.OFFICE_CODEX_CODEX_HOME ?? join(homedir(), ".codex"));
  const dataDir = process.env.OFFICE_CODEX_DATA_DIR ?? paths.data;

  return {
    port: overrides.port ?? parseNumber(process.env.OFFICE_CODEX_PORT, DEFAULT_PORT),
    codexHome: overrides.codexHome ?? codexHome,
    dataDir: overrides.dataDir ?? dataDir,
    idleMs: overrides.idleMs ?? parseNumber(process.env.OFFICE_CODEX_IDLE_MS, DEFAULT_IDLE_MS),
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
