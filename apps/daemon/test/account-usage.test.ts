import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountUsageService,
  deriveUsageWindows,
  resolveAccountUsageStatus,
} from "../src/account-usage.js";

async function createCodexHome(authPayload?: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "office-codex-account-"));

  if (authPayload !== undefined) {
    await writeFile(join(root, "auth.json"), JSON.stringify(authPayload), "utf8");
  }

  return root;
}

describe("deriveUsageWindows", () => {
  it("builds five hour and weekly buckets from the core rate limit", () => {
    expect(
      deriveUsageWindows({
        rate_limit: {
          primary_window: {
            limit_window_seconds: 5 * 60 * 60,
            reset_at: 1_741_506_180,
            used_percent: 4,
          },
          secondary_window: {
            limit_window_seconds: 7 * 24 * 60 * 60,
            reset_at: 1_742_128_800,
            used_percent: 12,
          },
        },
      }),
    ).toEqual([
      {
        key: "five_hour",
        label: "5h",
        remainingPercent: 96,
        resetsAt: expect.any(String),
      },
      {
        key: "weekly",
        label: "Weekly",
        remainingPercent: 88,
        resetsAt: expect.any(String),
      },
    ]);
  });
});

describe("resolveAccountUsageStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns unavailable when auth.json is missing or has no access token", async () => {
    const codexHome = await createCodexHome();

    await expect(
      resolveAccountUsageStatus({
        chatGptOrigin: "https://chatgpt.com",
        codexHome,
        logger: pino({ level: "silent" }),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      source: "auth-token-missing",
    });
  });

  it("returns unavailable with accounts/check diagnostics when wham usage is unauthorized", async () => {
    const codexHome = await createCodexHome({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "token",
      },
    });
    const fetchMock = vi.mocked(fetch);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    await expect(
      resolveAccountUsageStatus({
        chatGptOrigin: "https://chatgpt.com",
        codexHome,
        logger: pino({ level: "silent" }),
      }),
    ).resolves.toEqual({
      status: "unavailable",
      source: "wham/accounts/check:200:wham/usage:401",
    });
  });

  it("returns available when wham usage exposes a core rate limit", async () => {
    const codexHome = await createCodexHome({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "token",
      },
    });
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          additional_rate_limits: [
            {
              limit_name: "gpt-5",
              rate_limit: {
                primary_window: {
                  limit_window_seconds: 3_600,
                  reset_at: 1_741_506_180,
                  used_percent: 40,
                },
              },
            },
          ],
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_at: 1_741_506_180,
              used_percent: 4,
            },
            secondary_window: {
              limit_window_seconds: 604_800,
              reset_at: 1_742_128_800,
              used_percent: 12,
            },
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await expect(
      resolveAccountUsageStatus({
        chatGptOrigin: "https://chatgpt.com",
        codexHome,
        logger: pino({ level: "silent" }),
      }),
    ).resolves.toEqual({
      status: "available",
      windows: [
        {
          key: "five_hour",
          label: "5h",
          remainingPercent: 96,
          resetsAt: expect.any(String),
        },
        {
          key: "weekly",
          label: "Weekly",
          remainingPercent: 88,
          resetsAt: expect.any(String),
        },
      ],
      source: "wham/usage",
    });
  });
});

describe("AccountUsageService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes and notifies listeners only when the snapshot changes", async () => {
    const codexHome = await createCodexHome({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "token",
      },
    });
    const fetchMock = vi.mocked(fetch);

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                limit_window_seconds: 18_000,
                reset_at: 1_741_506_180,
                used_percent: 4,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                limit_window_seconds: 18_000,
                reset_at: 1_741_506_180,
                used_percent: 4,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                limit_window_seconds: 18_000,
                reset_at: 1_741_506_999,
                used_percent: 5,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      );

    const service = new AccountUsageService({
      chatGptOrigin: "https://chatgpt.com",
      codexHome,
      logger: pino({ level: "silent" }),
      refreshMs: 60_000,
    });
    const listener = vi.fn();
    service.subscribe(listener);

    await service.start();
    await service.refresh();
    await service.refresh();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual({
      status: "available",
      windows: [
        {
          key: "five_hour",
          label: "5h",
          remainingPercent: 95,
          resetsAt: expect.any(String),
        },
      ],
      source: "wham/usage",
    });

    await service.close();
  });
});
