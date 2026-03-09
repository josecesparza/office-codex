import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { AccountUsageStatus } from "@office-codex/core";
import type pino from "pino";

const execFile = promisify(execFileCallback);

export async function readAccountUsageStatus(
  stateDbPath: string | null,
  logger: pino.Logger,
): Promise<AccountUsageStatus> {
  if (!stateDbPath) {
    return {
      status: "unavailable",
      source: "state-db-missing",
    };
  }

  try {
    const query = `
      select count(*) as matches
      from logs
      where target = 'codex_app_server::outgoing_message'
        and message = 'app-server event: account/rateLimits/updated';
    `;
    const { stdout } = await execFile("sqlite3", ["-json", stateDbPath, query]);
    const [row] = JSON.parse(stdout) as Array<{ matches?: number }>;

    if ((row?.matches ?? 0) > 0) {
      return {
        status: "unavailable",
        source: "account/rateLimits/updated:event-without-payload",
      };
    }

    return {
      status: "unavailable",
      source: "rate-limit-source-not-found",
    };
  } catch (error) {
    logger.warn({ err: error, stateDbPath }, "Unable to inspect Codex account usage state");
    return {
      status: "error",
      source: "logs-query-failed",
    };
  }
}
