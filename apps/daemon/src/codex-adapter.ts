import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import {
  parseSessionIndexLine,
  parseTranscriptLine,
  parseTranscriptLines,
} from "@office-codex/core";
import type { ParsedTranscriptEntry } from "@office-codex/core";
import chokidar from "chokidar";
import type pino from "pino";

import { type DaemonConfig, pathExists } from "./config.js";
import type { CursorStore } from "./cursor-store.js";
import type { SessionSeedPatch, SessionStore } from "./session-store.js";

interface ThreadRecord {
  id: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  gitBranch: string | null;
}

interface PassiveCodexAdapter {
  close(): Promise<void>;
}

const execFile = promisify(execFileCallback);

function toIsoTimestamp(raw: number): string {
  return new Date(raw * 1000).toISOString();
}

function extractSessionId(filePath: string): string | null {
  const match = filePath.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
}

async function recursiveFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const nextPath = join(root, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await recursiveFiles(nextPath)));
      continue;
    }

    if (entry.isFile()) {
      results.push(nextPath);
    }
  }

  return results;
}

async function readThreadRecords(
  stateDbPath: string,
  logger: pino.Logger,
): Promise<ThreadRecord[]> {
  try {
    const betterSqlite = await import("better-sqlite3");
    const Database = betterSqlite.default;
    const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    const statement = db.prepare(`
      select
        id,
        title,
        cwd,
        created_at,
        updated_at,
        source,
        git_branch
      from threads
      order by updated_at desc
    `);
    const rows = statement.all() as Array<{
      id: string;
      title: string;
      cwd: string;
      created_at: number;
      updated_at: number;
      source: string;
      git_branch: string | null;
    }>;
    db.close();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      createdAt: toIsoTimestamp(row.created_at),
      updatedAt: toIsoTimestamp(row.updated_at),
      source: row.source,
      gitBranch: row.git_branch,
    }));
  } catch (error) {
    logger.warn(
      { err: error, stateDbPath },
      "Unable to read Codex threads database via better-sqlite3, falling back to sqlite3",
    );
  }

  try {
    const query = `
      select
        id,
        title,
        cwd,
        created_at,
        updated_at,
        source,
        git_branch
      from threads
      order by updated_at desc;
    `;
    const { stdout } = await execFile("sqlite3", ["-json", stateDbPath, query]);
    const rows = JSON.parse(stdout) as Array<{
      id: string;
      title: string;
      cwd: string;
      created_at: number;
      updated_at: number;
      source: string;
      git_branch: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      createdAt: toIsoTimestamp(row.created_at),
      updatedAt: toIsoTimestamp(row.updated_at),
      source: row.source,
      gitBranch: row.git_branch,
    }));
  } catch (error) {
    logger.warn({ err: error, stateDbPath }, "Unable to read Codex threads database via sqlite3");
    return [];
  }
}

async function findLatestStateDb(codexHome: string): Promise<string | null> {
  const entries = await readdir(codexHome, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && /^state_.*\.sqlite$/.test(entry.name))
    .map((entry) => join(codexHome, entry.name));

  if (candidates.length === 0) {
    return null;
  }

  const stats = await Promise.all(
    candidates.map(async (candidate) => ({
      path: candidate,
      stats: await stat(candidate),
    })),
  );

  stats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  return stats[0]?.path ?? null;
}

async function readNewLines(filePath: string, cursorStore: CursorStore): Promise<string[]> {
  const buffer = await readFile(filePath);
  const previous = cursorStore.get(filePath);
  const safeOffset = buffer.length < previous.offset ? 0 : previous.offset;
  const chunk = buffer.subarray(safeOffset).toString("utf8");
  const combined = previous.remainder + chunk;
  const hasTrailingNewline = combined.endsWith("\n");
  const pieces = combined.split("\n");
  const remainder = hasTrailingNewline ? "" : (pieces.pop() ?? "");
  const nextOffset = buffer.length - Buffer.byteLength(remainder);

  cursorStore.set(filePath, {
    offset: nextOffset,
    remainder,
  });

  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
}

function seedFromEntry(
  sessionId: string,
  filePath: string,
  entry: ParsedTranscriptEntry,
): SessionSeedPatch {
  if (entry.kind !== "session_meta") {
    return {
      sessionId,
      rolloutPath: filePath,
      updatedAt: entry.timestamp,
    };
  }

  return {
    sessionId,
    source: entry.source,
    cwd: entry.cwd,
    rolloutPath: filePath,
    startedAt: entry.timestamp,
    updatedAt: entry.timestamp,
  };
}

async function ingestExistingTranscript(
  filePath: string,
  store: SessionStore,
  cursorStore: CursorStore,
): Promise<void> {
  const sessionId = extractSessionId(filePath);

  if (!sessionId) {
    return;
  }

  const contents = await readFile(filePath, "utf8");
  const entries = parseTranscriptLines(contents);

  for (const entry of entries) {
    store.applyEntry(sessionId, entry, seedFromEntry(sessionId, filePath, entry));
  }

  cursorStore.set(filePath, {
    offset: Buffer.byteLength(contents),
    remainder: "",
  });
}

async function readSessionIndexBootstrap(sessionIndexPath: string): Promise<SessionSeedPatch[]> {
  const contents = await readFile(sessionIndexPath, "utf8");

  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed = parseSessionIndexLine(line);

      if (!parsed) {
        return [];
      }

      return [
        {
          sessionId: parsed.id,
          title: parsed.threadName,
          updatedAt: parsed.updatedAt,
        },
      ];
    });
}

async function handleChangedSessionIndex(
  filePath: string,
  store: SessionStore,
  cursorStore: CursorStore,
): Promise<void> {
  const lines = await readNewLines(filePath, cursorStore);

  for (const line of lines) {
    const parsed = parseSessionIndexLine(line);

    if (!parsed) {
      continue;
    }

    store.upsertSeed({
      sessionId: parsed.id,
      title: parsed.threadName,
      updatedAt: parsed.updatedAt,
    });
  }
}

async function handleChangedTranscript(
  filePath: string,
  store: SessionStore,
  cursorStore: CursorStore,
): Promise<void> {
  const sessionId = extractSessionId(filePath);

  if (!sessionId) {
    return;
  }

  const lines = await readNewLines(filePath, cursorStore);

  for (const line of lines) {
    const parsed = parseTranscriptLine(line);

    if (!parsed) {
      continue;
    }

    store.applyEntry(sessionId, parsed, seedFromEntry(sessionId, filePath, parsed));
  }
}

export async function startPassiveCodexAdapter(options: {
  config: DaemonConfig;
  store: SessionStore;
  cursorStore: CursorStore;
  logger: pino.Logger;
}): Promise<PassiveCodexAdapter> {
  const { config, cursorStore, logger, store } = options;
  const sessionIndexPath = join(config.codexHome, "session_index.jsonl");
  const sessionsRoot = join(config.codexHome, "sessions");
  const latestStateDb = (await pathExists(config.codexHome))
    ? await findLatestStateDb(config.codexHome)
    : null;

  if (latestStateDb) {
    const threads = await readThreadRecords(latestStateDb, logger);

    for (const thread of threads) {
      store.upsertSeed({
        sessionId: thread.id,
        title: thread.title,
        cwd: thread.cwd,
        source: thread.source,
        startedAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        gitBranch: thread.gitBranch,
      });
    }
  }

  if (await pathExists(sessionIndexPath)) {
    for (const seed of await readSessionIndexBootstrap(sessionIndexPath)) {
      store.upsertSeed(seed);
    }
  }

  if (await pathExists(sessionsRoot)) {
    const files = (await recursiveFiles(sessionsRoot)).filter(
      (filePath) => extname(filePath) === ".jsonl",
    );

    for (const filePath of files) {
      await ingestExistingTranscript(filePath, store, cursorStore);
    }
  }

  const watcher = chokidar.watch([sessionIndexPath, sessionsRoot], {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const onFileChange = async (filePath: string): Promise<void> => {
    try {
      if (filePath === sessionIndexPath) {
        await handleChangedSessionIndex(filePath, store, cursorStore);
        return;
      }

      if (filePath.startsWith(sessionsRoot) && extname(filePath) === ".jsonl") {
        await handleChangedTranscript(filePath, store, cursorStore);
      }
    } catch (error) {
      logger.warn({ err: error, filePath }, "Unable to ingest Codex transcript update");
    }
  };

  watcher.on("add", (filePath) => void onFileChange(filePath));
  watcher.on("change", (filePath) => void onFileChange(filePath));

  const idleTimer = setInterval(() => {
    store.markStaleSessionsOffline(Date.now(), config.idleMs);
  }, 30_000);
  idleTimer.unref();

  return {
    async close() {
      clearInterval(idleTimer);
      await watcher.close();
      await cursorStore.persist();
    },
  };
}
