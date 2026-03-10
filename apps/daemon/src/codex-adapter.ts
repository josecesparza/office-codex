import { execFile as execFileCallback } from "node:child_process";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

import { parseSessionIndexLine, parseTranscriptLine } from "@office-codex/core";
import type { ParsedTranscriptEntry } from "@office-codex/core";
import type { AgentSession } from "@office-codex/core";
import chokidar from "chokidar";
import type pino from "pino";

import { type DaemonConfig, pathExists } from "./config.js";
import type { CursorStore } from "./cursor-store.js";
import type { SessionSeedPatch, SessionStore } from "./session-store.js";
import { deriveTitleFromPromptText, looksLikeMachineTitle } from "./session-titles.js";

type DbReaderMode = "better-sqlite3" | "sqlite3" | "unavailable";

interface RawThreadRow {
  created_at: number;
  cwd: string;
  first_user_message: string | null;
  git_branch: string | null;
  id: string;
  source: string;
  title: string | null;
  tokens_used: number | null;
  updated_at: number;
}

interface ThreadRecord {
  createdAt: string;
  cwd: string;
  firstUserMessage: string | null;
  gitBranch: string | null;
  id: string;
  source: string;
  title: string;
  tokensUsed: number | null;
  updatedAt: string;
}

export interface PassiveCodexAdapterMetrics {
  bootstrapDurationMs: number;
  bootstrappedSeeds: number;
  bootstrappedTranscripts: number;
  dbReader: DbReaderMode;
  ingestErrors: number;
  lastIngestAt: string | null;
  parseErrors: number;
  stateDbPath: string | null;
  watchedRoots: string[];
}

export interface PassiveCodexAdapter {
  close(): Promise<void>;
  getMetrics(): PassiveCodexAdapterMetrics;
}

const execFile = promisify(execFileCallback);

function toIsoTimestamp(raw: number): string {
  return new Date(raw * 1000).toISOString();
}

function extractSessionId(filePath: string): string | null {
  const match = filePath.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] ?? null;
}

function sortByUpdatedAtDesc<T extends { updatedAt?: string }>(values: T[]): T[] {
  return [...values].sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
  );
}

function resolveThreadTitle(
  title: string | null,
  firstUserMessage: string | null,
  config: DaemonConfig,
): string {
  const normalizedTitle = title?.trim() ?? "";

  if (normalizedTitle && !looksLikeMachineTitle(normalizedTitle)) {
    return normalizedTitle;
  }

  if (config.titleHydrationMode === "first_user_message") {
    const hydratedTitle = deriveTitleFromPromptText(firstUserMessage);

    if (hydratedTitle) {
      return hydratedTitle;
    }
  }

  return normalizedTitle;
}

function mapThreadRow(row: RawThreadRow, config: DaemonConfig): ThreadRecord {
  return {
    createdAt: toIsoTimestamp(row.created_at),
    cwd: row.cwd,
    firstUserMessage: row.first_user_message,
    gitBranch: row.git_branch,
    id: row.id,
    source: row.source,
    title: resolveThreadTitle(row.title, row.first_user_message, config),
    tokensUsed: row.tokens_used,
    updatedAt: toIsoTimestamp(row.updated_at),
  };
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

async function queryThreadsWithBetterSqlite(
  stateDbPath: string,
  query: string,
  args: readonly string[],
): Promise<RawThreadRow[]> {
  const betterSqlite = await import("better-sqlite3");
  const Database = betterSqlite.default;
  const db = new Database(stateDbPath, { readonly: true, fileMustExist: true });

  try {
    const statement = db.prepare(query);
    return statement.all(...args) as RawThreadRow[];
  } finally {
    db.close();
  }
}

async function queryThreadsWithSqlite3(
  stateDbPath: string,
  query: string,
  args: readonly string[],
): Promise<RawThreadRow[]> {
  let effectiveQuery = query;

  if (args.length > 0) {
    const [sessionId] = args;

    if (sessionId) {
      const escaped = sessionId.replaceAll("'", "''");
      effectiveQuery = query.replace("?", `'${escaped}'`);
    }
  }

  const { stdout } = await execFile("sqlite3", ["-json", stateDbPath, effectiveQuery]);
  return stdout.trim() ? (JSON.parse(stdout) as RawThreadRow[]) : [];
}

async function readThreadRows(
  stateDbPath: string,
  query: string,
  args: readonly string[],
  logger: pino.Logger,
): Promise<{ reader: DbReaderMode; rows: RawThreadRow[] }> {
  try {
    return {
      reader: "better-sqlite3",
      rows: await queryThreadsWithBetterSqlite(stateDbPath, query, args),
    };
  } catch (error) {
    logger.warn(
      { err: error, stateDbPath },
      "Unable to read Codex threads database via better-sqlite3, falling back to sqlite3",
    );
  }

  try {
    return {
      reader: "sqlite3",
      rows: await queryThreadsWithSqlite3(stateDbPath, query, args),
    };
  } catch (error) {
    logger.warn({ err: error, stateDbPath }, "Unable to read Codex threads database via sqlite3");
    return {
      reader: "unavailable",
      rows: [],
    };
  }
}

async function readThreadRecords(
  stateDbPath: string,
  config: DaemonConfig,
  logger: pino.Logger,
): Promise<{ reader: DbReaderMode; rows: ThreadRecord[] }> {
  const query = `
    select
      id,
      title,
      first_user_message,
      cwd,
      created_at,
      updated_at,
      source,
      git_branch,
      tokens_used
    from threads
    order by updated_at desc
    limit ${config.bootstrapSeedLimit};
  `;
  const result = await readThreadRows(stateDbPath, query, [], logger);

  return {
    reader: result.reader,
    rows: result.rows.map((row) => mapThreadRow(row, config)),
  };
}

async function readThreadRecordById(
  stateDbPath: string,
  config: DaemonConfig,
  sessionId: string,
  logger: pino.Logger,
): Promise<ThreadRecord | null> {
  const query = `
    select
      id,
      title,
      first_user_message,
      cwd,
      created_at,
      updated_at,
      source,
      git_branch,
      tokens_used
    from threads
    where id = ?
    limit 1;
  `;
  const result = await readThreadRows(stateDbPath, query, [sessionId], logger);
  const row = result.rows[0];
  return row ? mapThreadRow(row, config) : null;
}

export async function findLatestStateDb(codexHome: string): Promise<string | null> {
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
  const handle = await open(filePath, "r");

  try {
    const fileStats = await handle.stat();
    const previous = cursorStore.get(filePath);
    const fileIno = typeof fileStats.ino === "number" ? fileStats.ino : null;
    const didRotate = previous.ino !== null && fileIno !== null && previous.ino !== fileIno;
    const didTruncate = fileStats.size < previous.offset;
    const cursor =
      didRotate || didTruncate ? { ino: fileIno, offset: 0, remainder: "", size: 0 } : previous;
    const bytesToRead = Math.max(0, fileStats.size - cursor.offset);
    let chunk = "";

    if (bytesToRead > 0) {
      const buffer = Buffer.alloc(bytesToRead);
      await handle.read(buffer, 0, bytesToRead, cursor.offset);
      chunk = buffer.toString("utf8");
    }

    const combined = cursor.remainder + chunk;
    const hasTrailingNewline = combined.endsWith("\n");
    const pieces = combined.split("\n");
    const remainder = hasTrailingNewline ? "" : (pieces.pop() ?? "");

    cursorStore.set(filePath, {
      ino: fileIno,
      offset: fileStats.size,
      remainder,
      size: fileStats.size,
    });

    return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
  } finally {
    await handle.close();
  }
}

function seedFromEntry(
  sessionId: string,
  filePath: string,
  entry: ParsedTranscriptEntry,
): SessionSeedPatch {
  if (entry.kind !== "session_meta") {
    return {
      identityConfidence: "high",
      rolloutPath: filePath,
      sessionId,
      stateSource: "transcript",
      updatedAt: entry.timestamp,
    };
  }

  return {
    cwd: entry.cwd,
    identityConfidence: "high",
    rolloutPath: filePath,
    sessionId,
    source: entry.source,
    startedAt: entry.timestamp,
    stateSource: "transcript",
    updatedAt: entry.timestamp,
  };
}

function markSuccessfulIngest(metrics: PassiveCodexAdapterMetrics, timestamp: string): void {
  metrics.lastIngestAt = timestamp;
}

async function ingestTranscriptContents(options: {
  config: DaemonConfig;
  contents: string;
  filePath: string;
  logger: pino.Logger;
  metrics: PassiveCodexAdapterMetrics;
  sessionId: string;
  stateDbPath: string | null;
  store: SessionStore;
}): Promise<void> {
  const lines = options.contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const parsed = parseTranscriptLine(line);

    if (!parsed) {
      options.metrics.parseErrors += 1;
      continue;
    }

    options.store.applyEntry(
      options.sessionId,
      parsed,
      seedFromEntry(options.sessionId, options.filePath, parsed),
    );
    markSuccessfulIngest(options.metrics, parsed.timestamp);
  }

  if (!options.stateDbPath) {
    return;
  }

  const thread = await readThreadRecordById(
    options.stateDbPath,
    options.config,
    options.sessionId,
    options.logger,
  );

  if (!thread) {
    return;
  }

  options.store.upsertSeed({
    cwd: thread.cwd,
    gitBranch: thread.gitBranch,
    identityConfidence: "high",
    sessionId: thread.id,
    source: thread.source,
    startedAt: thread.createdAt,
    stateSource: "transcript",
    title: thread.title,
    tokensUsed: thread.tokensUsed,
    updatedAt: thread.updatedAt,
  });
}

async function ingestExistingTranscript(options: {
  config: DaemonConfig;
  cursorStore: CursorStore;
  filePath: string;
  logger: pino.Logger;
  metrics: PassiveCodexAdapterMetrics;
  stateDbPath: string | null;
  store: SessionStore;
}): Promise<void> {
  const sessionId = extractSessionId(options.filePath);

  if (!sessionId) {
    return;
  }

  const [contents, fileStats] = await Promise.all([
    readFile(options.filePath, "utf8"),
    stat(options.filePath),
  ]);

  await ingestTranscriptContents({
    config: options.config,
    contents,
    filePath: options.filePath,
    logger: options.logger,
    metrics: options.metrics,
    sessionId,
    stateDbPath: options.stateDbPath,
    store: options.store,
  });

  options.cursorStore.set(options.filePath, {
    ino: typeof fileStats.ino === "number" ? fileStats.ino : null,
    offset: fileStats.size,
    remainder: "",
    size: fileStats.size,
  });
}

async function readSessionIndexBootstrap(
  sessionIndexPath: string,
  limit: number,
  metrics: PassiveCodexAdapterMetrics,
): Promise<SessionSeedPatch[]> {
  const contents = await readFile(sessionIndexPath, "utf8");
  const seeds: SessionSeedPatch[] = [];

  for (const line of contents
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)) {
    const parsed = parseSessionIndexLine(line);

    if (!parsed) {
      metrics.parseErrors += 1;
      continue;
    }

    const patch: SessionSeedPatch = {
      identityConfidence: "low",
      sessionId: parsed.id,
      updatedAt: parsed.updatedAt,
    };

    if (!looksLikeMachineTitle(parsed.threadName)) {
      patch.title = parsed.threadName;
    }

    seeds.push(patch);
  }

  return sortByUpdatedAtDesc(seeds).slice(0, limit);
}

async function handleChangedSessionIndex(
  filePath: string,
  store: SessionStore,
  cursorStore: CursorStore,
  metrics: PassiveCodexAdapterMetrics,
): Promise<void> {
  const lines = await readNewLines(filePath, cursorStore);

  for (const line of lines) {
    const parsed = parseSessionIndexLine(line);

    if (!parsed) {
      metrics.parseErrors += 1;
      continue;
    }

    const patch: SessionSeedPatch = {
      identityConfidence: "low",
      sessionId: parsed.id,
      updatedAt: parsed.updatedAt,
    };

    if (!looksLikeMachineTitle(parsed.threadName)) {
      patch.title = parsed.threadName;
    }

    store.upsertSeed(patch);
    markSuccessfulIngest(metrics, parsed.updatedAt);
  }
}

async function handleChangedTranscript(options: {
  config: DaemonConfig;
  cursorStore: CursorStore;
  filePath: string;
  logger: pino.Logger;
  metrics: PassiveCodexAdapterMetrics;
  stateDbPath: string | null;
  store: SessionStore;
}): Promise<void> {
  const sessionId = extractSessionId(options.filePath);

  if (!sessionId) {
    return;
  }

  const lines = await readNewLines(options.filePath, options.cursorStore);

  if (lines.length === 0) {
    return;
  }

  await ingestTranscriptContents({
    config: options.config,
    contents: `${lines.join("\n")}\n`,
    filePath: options.filePath,
    logger: options.logger,
    metrics: options.metrics,
    sessionId,
    stateDbPath: options.stateDbPath,
    store: options.store,
  });
}

function buildBootstrapTranscriptTargetIds(
  sessions: AgentSession[],
  now: number,
  config: DaemonConfig,
): Set<string> {
  const targetIds = new Set<string>();
  const sortedSessions = sortByUpdatedAtDesc(sessions);
  const recentThreshold = now - config.idleMs;

  for (const session of sortedSessions) {
    const updatedAt = Date.parse(session.updatedAt);

    if (Number.isFinite(updatedAt) && updatedAt >= recentThreshold) {
      targetIds.add(session.sessionId);
    }
  }

  for (const session of sortedSessions.slice(0, config.offlineHistoryCap)) {
    targetIds.add(session.sessionId);
  }

  return targetIds;
}

function markHistoricalSeedsOffline(store: SessionStore, now: number, idleMs: number): void {
  for (const session of store.list()) {
    const updatedAt = Date.parse(session.updatedAt);

    if (!Number.isFinite(updatedAt) || updatedAt >= now - idleMs) {
      continue;
    }

    store.markOffline(session.sessionId, session.updatedAt, {
      reason: "archived",
      preserveUpdatedAt: true,
    });
  }
}

export async function startPassiveCodexAdapter(options: {
  config: DaemonConfig;
  cursorStore: CursorStore;
  logger: pino.Logger;
  store: SessionStore;
}): Promise<PassiveCodexAdapter> {
  const { config, cursorStore, logger, store } = options;
  const sessionIndexPath = join(config.codexHome, "session_index.jsonl");
  const sessionsRoot = join(config.codexHome, "sessions");
  const watchedRoots = [sessionIndexPath, sessionsRoot];
  const metrics: PassiveCodexAdapterMetrics = {
    bootstrapDurationMs: 0,
    bootstrappedSeeds: 0,
    bootstrappedTranscripts: 0,
    dbReader: "unavailable",
    ingestErrors: 0,
    lastIngestAt: null,
    parseErrors: 0,
    stateDbPath: null,
    watchedRoots,
  };
  const bootstrapSeedIds = new Set<string>();
  const bootstrapStartedAt = Date.now();
  const latestStateDb = (await pathExists(config.codexHome))
    ? await findLatestStateDb(config.codexHome)
    : null;

  metrics.stateDbPath = latestStateDb;

  if (latestStateDb) {
    const threads = await readThreadRecords(latestStateDb, config, logger);
    metrics.dbReader = threads.reader;

    for (const thread of threads.rows) {
      store.upsertSeed({
        cwd: thread.cwd,
        gitBranch: thread.gitBranch,
        identityConfidence: "medium",
        sessionId: thread.id,
        source: thread.source,
        startedAt: thread.createdAt,
        title: thread.title,
        tokensUsed: thread.tokensUsed,
        updatedAt: thread.updatedAt,
      });
      bootstrapSeedIds.add(thread.id);
    }
  }

  if (await pathExists(sessionIndexPath)) {
    for (const seed of await readSessionIndexBootstrap(
      sessionIndexPath,
      config.bootstrapSeedLimit,
      metrics,
    )) {
      store.upsertSeed(seed);
      bootstrapSeedIds.add(seed.sessionId);
    }
  }

  metrics.bootstrappedSeeds = bootstrapSeedIds.size;
  markHistoricalSeedsOffline(store, Date.now(), config.idleMs);

  if (await pathExists(sessionsRoot)) {
    const bootstrapTargetIds = buildBootstrapTranscriptTargetIds(store.list(), Date.now(), config);
    const files = (await recursiveFiles(sessionsRoot))
      .filter((filePath) => extname(filePath) === ".jsonl")
      .sort();

    for (const filePath of files) {
      const sessionId = extractSessionId(filePath);

      if (!sessionId || !bootstrapTargetIds.has(sessionId)) {
        continue;
      }

      try {
        await ingestExistingTranscript({
          config,
          cursorStore,
          filePath,
          logger,
          metrics,
          stateDbPath: latestStateDb,
          store,
        });
        metrics.bootstrappedTranscripts += 1;
      } catch (error) {
        metrics.ingestErrors += 1;
        logger.warn({ err: error, filePath }, "Unable to bootstrap Codex transcript");
      }
    }
  }

  markHistoricalSeedsOffline(store, Date.now(), config.idleMs);

  metrics.bootstrapDurationMs = Date.now() - bootstrapStartedAt;

  const watcher = chokidar.watch(watchedRoots, {
    awaitWriteFinish: {
      pollInterval: 50,
      stabilityThreshold: 200,
    },
    ignoreInitial: true,
  });

  const onFileChange = async (filePath: string): Promise<void> => {
    try {
      if (filePath === sessionIndexPath) {
        await handleChangedSessionIndex(filePath, store, cursorStore, metrics);
        return;
      }

      if (filePath.startsWith(sessionsRoot) && extname(filePath) === ".jsonl") {
        await handleChangedTranscript({
          config,
          cursorStore,
          filePath,
          logger,
          metrics,
          stateDbPath: latestStateDb,
          store,
        });
      }
    } catch (error) {
      metrics.ingestErrors += 1;
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
    getMetrics() {
      return {
        ...metrics,
      };
    },
  };
}
