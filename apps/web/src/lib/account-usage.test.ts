import { describe, expect, it } from "vitest";

import type { AccountUsageStatus } from "@office-codex/core";

import { formatAccountUsageSummary, shouldShowUnavailableUsage } from "./account-usage";

describe("account usage helpers", () => {
  it("formats the compact topbar summary in the expected order", () => {
    const account: AccountUsageStatus = {
      status: "available",
      windows: [
        {
          key: "weekly",
          label: "Weekly",
          remainingPercent: 88.2,
          resetsAt: "Mar 16",
        },
        {
          key: "five_hour",
          label: "5h",
          remainingPercent: 96.1,
          resetsAt: "1:43 AM",
        },
      ],
    };

    expect(formatAccountUsageSummary(account)).toBe("5h 96% · Weekly 88%");
  });

  it("returns null for non-available account states and shows the neutral badge", () => {
    expect(
      formatAccountUsageSummary({
        status: "unavailable",
        source: "auth-token-missing",
      }),
    ).toBeNull();
    expect(
      shouldShowUnavailableUsage({
        status: "unavailable",
        source: "auth-token-missing",
      }),
    ).toBe(true);
    expect(
      shouldShowUnavailableUsage({
        status: "error",
        source: "wham/usage:request-failed",
      }),
    ).toBe(true);
  });
});
