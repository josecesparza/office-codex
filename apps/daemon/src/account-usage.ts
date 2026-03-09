import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AccountUsageStatus, AccountUsageWindow } from "@office-codex/core";
import type pino from "pino";
import { z } from "zod";

const DEFAULT_CHATGPT_ORIGIN = "https://chatgpt.com";
const FIVE_HOUR_WINDOW_MINUTES = 300;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;

const authFileSchema = z.object({
  auth_mode: z.string().optional(),
  tokens: z
    .object({
      access_token: z.string().min(1).optional(),
    })
    .optional(),
});

const usageWindowSchema = z.object({
  limit_window_seconds: z.number().nullable().optional(),
  reset_at: z.number().nullable().optional(),
  used_percent: z.number().nullable().optional(),
});

const usagePayloadSchema = z.object({
  rate_limit: z
    .object({
      primary_window: usageWindowSchema.nullish(),
      secondary_window: usageWindowSchema.nullish(),
    })
    .nullish(),
});

interface AccountUsageServiceOptions {
  chatGptOrigin: string;
  codexHome: string;
  logger: pino.Logger;
  refreshMs: number;
}

interface AccountWindowBucket {
  resetAt: number | null;
  usedPercent: number;
  windowMinutes: number | null;
}

type AccountUsageServiceListener = (snapshot: AccountUsageStatus) => void;

function sanitizeOrigin(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}

function normalizePercent(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(0, Math.min(100, 100 - Number(value)));
}

function normalizeBucket(
  window: z.infer<typeof usageWindowSchema> | null | undefined,
): AccountWindowBucket | null {
  if (!window) {
    return null;
  }

  const usedPercent = typeof window.used_percent === "number" ? window.used_percent : null;
  const resetAt = typeof window.reset_at === "number" ? window.reset_at : null;

  if (usedPercent === null && resetAt === null) {
    return null;
  }

  return {
    resetAt,
    usedPercent: Math.max(0, Math.min(100, usedPercent ?? 0)),
    windowMinutes: resetAt === null ? null : null,
  };
}

function toWindowBucket(
  window: z.infer<typeof usageWindowSchema> | null | undefined,
  fallbackSeconds: number | null,
): AccountWindowBucket | null {
  const bucket = normalizeBucket(window);

  if (!bucket) {
    return null;
  }

  return {
    ...bucket,
    windowMinutes:
      typeof window?.limit_window_seconds === "number" &&
      Number.isFinite(window.limit_window_seconds)
        ? Math.max(0, Math.round(window.limit_window_seconds / 60))
        : typeof fallbackSeconds === "number" && Number.isFinite(fallbackSeconds)
          ? Math.max(0, Math.round(fallbackSeconds / 60))
          : null,
  };
}

function closestBucket(
  windows: AccountWindowBucket[],
  matcher: (bucket: AccountWindowBucket) => boolean,
  targetMinutes: number,
): AccountWindowBucket | null {
  const candidates = windows.filter(matcher);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((best, candidate) => {
    if (best.windowMinutes === null) {
      return candidate;
    }

    if (candidate.windowMinutes === null) {
      return best;
    }

    const bestDistance = Math.abs(best.windowMinutes - targetMinutes);
    const candidateDistance = Math.abs(candidate.windowMinutes - targetMinutes);

    if (candidateDistance < bestDistance) {
      return candidate;
    }

    if (candidateDistance > bestDistance) {
      return best;
    }

    return candidate.windowMinutes > best.windowMinutes ? candidate : best;
  });
}

function formatResetAt(resetAt: number | null): string | null {
  if (!Number.isFinite(resetAt)) {
    return null;
  }

  const date = new Date(Number(resetAt) * 1000);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return sameDay
    ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function deriveUsageWindows(
  payload: z.infer<typeof usagePayloadSchema>,
): AccountUsageWindow[] {
  const primary = payload.rate_limit?.primary_window;
  const secondary = payload.rate_limit?.secondary_window;
  const windows = [
    toWindowBucket(primary, FIVE_HOUR_WINDOW_MINUTES * 60),
    toWindowBucket(secondary, WEEKLY_WINDOW_MINUTES * 60),
  ].filter((bucket): bucket is AccountWindowBucket => bucket !== null);

  const next: AccountUsageWindow[] = [];
  const fiveHour = closestBucket(
    windows,
    (bucket) => bucket.windowMinutes !== null && bucket.windowMinutes < 1440,
    FIVE_HOUR_WINDOW_MINUTES,
  );
  const weekly = closestBucket(
    windows,
    (bucket) => bucket.windowMinutes !== null && bucket.windowMinutes >= 1440,
    WEEKLY_WINDOW_MINUTES,
  );

  if (fiveHour) {
    next.push({
      key: "five_hour",
      label: "5h",
      remainingPercent: normalizePercent(fiveHour.usedPercent),
      resetsAt: formatResetAt(fiveHour.resetAt),
    });
  }

  if (weekly) {
    next.push({
      key: "weekly",
      label: "Weekly",
      remainingPercent: normalizePercent(weekly.usedPercent),
      resetsAt: formatResetAt(weekly.resetAt),
    });
  }

  return next;
}

async function readAccessToken(
  codexHome: string,
): Promise<{ accessToken: string | null; authMode: string | null }> {
  try {
    const authPath = join(codexHome, "auth.json");
    const raw = await readFile(authPath, "utf8");
    const parsed = authFileSchema.parse(JSON.parse(raw));

    return {
      accessToken: parsed.tokens?.access_token ?? null,
      authMode: parsed.auth_mode ?? null,
    };
  } catch {
    return {
      accessToken: null,
      authMode: null,
    };
  }
}

async function fetchJson(
  url: string,
  accessToken: string,
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    body,
    status: response.status,
  };
}

async function classifyUnavailable(
  origin: string,
  accessToken: string,
  usageStatus: number,
): Promise<AccountUsageStatus> {
  try {
    const accountCheck = await fetchJson(`${origin}/wham/accounts/check`, accessToken);

    return {
      status: "unavailable",
      source: `wham/accounts/check:${accountCheck.status}:wham/usage:${usageStatus}`,
    };
  } catch {
    return {
      status: "unavailable",
      source: `wham/usage:${usageStatus}`,
    };
  }
}

export async function resolveAccountUsageStatus(options: {
  chatGptOrigin: string;
  codexHome: string;
  logger: pino.Logger;
}): Promise<AccountUsageStatus> {
  const origin = sanitizeOrigin(options.chatGptOrigin || DEFAULT_CHATGPT_ORIGIN);
  const { accessToken, authMode } = await readAccessToken(options.codexHome);

  if (!accessToken) {
    return {
      status: "unavailable",
      source: "auth-token-missing",
    };
  }

  if (authMode && authMode !== "chatgpt") {
    return {
      status: "unavailable",
      source: `unsupported-auth-mode:${authMode}`,
    };
  }

  try {
    const payload = await fetchJson(`${origin}/wham/usage`, accessToken);

    if ([401, 403, 404].includes(payload.status)) {
      return classifyUnavailable(origin, accessToken, payload.status);
    }

    if (payload.status < 200 || payload.status >= 300) {
      return {
        status: "error",
        source: `wham/usage:${payload.status}`,
      };
    }

    const parsed = usagePayloadSchema.safeParse(payload.body);

    if (!parsed.success) {
      return {
        status: "unavailable",
        source: "wham/usage:invalid-payload",
      };
    }

    const windows = deriveUsageWindows(parsed.data);

    if (windows.length === 0) {
      return {
        status: "unavailable",
        source: "wham/usage:no-core-windows",
      };
    }

    return {
      status: "available",
      windows,
      source: "wham/usage",
    };
  } catch (error) {
    options.logger.warn({ err: error }, "Unable to refresh Codex account usage state");
    return {
      status: "error",
      source: "wham/usage:request-failed",
    };
  }
}

function statusEquals(left: AccountUsageStatus, right: AccountUsageStatus): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class AccountUsageService {
  private readonly listeners = new Set<AccountUsageServiceListener>();
  private readonly logger: pino.Logger;
  private readonly codexHome: string;
  private readonly chatGptOrigin: string;
  private readonly refreshMs: number;
  private snapshot: AccountUsageStatus = {
    status: "unavailable",
    source: "not-initialized",
  };
  private timer: NodeJS.Timeout | null = null;

  constructor(options: AccountUsageServiceOptions) {
    this.chatGptOrigin = sanitizeOrigin(options.chatGptOrigin || DEFAULT_CHATGPT_ORIGIN);
    this.codexHome = options.codexHome;
    this.logger = options.logger;
    this.refreshMs = options.refreshMs;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.refreshMs);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): AccountUsageStatus {
    return this.snapshot;
  }

  subscribe(listener: AccountUsageServiceListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async refresh(): Promise<AccountUsageStatus> {
    const next = await resolveAccountUsageStatus({
      chatGptOrigin: this.chatGptOrigin,
      codexHome: this.codexHome,
      logger: this.logger,
    });

    if (!statusEquals(this.snapshot, next)) {
      this.snapshot = next;

      for (const listener of this.listeners) {
        listener(next);
      }
    } else {
      this.snapshot = next;
    }

    return next;
  }
}
