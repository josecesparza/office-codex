import type { AccountUsageStatus, AccountUsageWindow } from "@office-codex/core";

function sortWindows(windows: AccountUsageWindow[]): AccountUsageWindow[] {
  const priority: Record<AccountUsageWindow["key"], number> = {
    five_hour: 0,
    weekly: 1,
  };

  return [...windows].sort((left, right) => priority[left.key] - priority[right.key]);
}

export function formatAccountUsageSummary(account: AccountUsageStatus | null): string | null {
  if (account?.status !== "available" || !account.windows || account.windows.length === 0) {
    return null;
  }

  return sortWindows(account.windows)
    .map((window) => `${window.label} ${Math.round(window.remainingPercent)}%`)
    .join(" · ");
}

export function shouldShowUnavailableUsage(account: AccountUsageStatus | null): boolean {
  return account?.status === "unavailable" || account?.status === "error";
}
