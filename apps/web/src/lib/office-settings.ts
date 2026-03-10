export const OFFICE_UI_SETTINGS_STORAGE_KEY = "office-codex.settings.v1";
export const LIVE_ROSTER_LIMIT_OPTIONS = [12, 20, 40] as const;
export const HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const TOOLTIP_DETAIL_LEVEL_OPTIONS = ["minimal", "full"] as const;

export type TooltipDetailLevel = (typeof TOOLTIP_DETAIL_LEVEL_OPTIONS)[number];

export interface OfficeUiSettings {
  compactMode: boolean;
  historyPageSize: (typeof HISTORY_PAGE_SIZE_OPTIONS)[number];
  liveRosterLimit: (typeof LIVE_ROSTER_LIMIT_OPTIONS)[number];
  reducedMotion: boolean;
  showAttentionInbox: boolean;
  showOfflineHistoryByDefault: boolean;
  showOfficeTooltips: boolean;
  tooltipDetailLevel: TooltipDetailLevel;
}

export const DEFAULT_OFFICE_UI_SETTINGS: OfficeUiSettings = {
  compactMode: false,
  historyPageSize: 20,
  liveRosterLimit: 20,
  reducedMotion: false,
  showAttentionInbox: true,
  showOfflineHistoryByDefault: false,
  showOfficeTooltips: true,
  tooltipDetailLevel: "full",
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  return globalThis.localStorage;
}

function isAllowedNumber<T extends readonly number[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "number" && allowed.includes(value as T[number]);
}

function isAllowedString<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]);
}

export function sanitizeOfficeUiSettings(value: unknown): OfficeUiSettings {
  const candidate =
    value && typeof value === "object" ? (value as Partial<OfficeUiSettings>) : undefined;

  return {
    compactMode:
      typeof candidate?.compactMode === "boolean"
        ? candidate.compactMode
        : DEFAULT_OFFICE_UI_SETTINGS.compactMode,
    historyPageSize: isAllowedNumber(candidate?.historyPageSize, HISTORY_PAGE_SIZE_OPTIONS)
      ? candidate.historyPageSize
      : DEFAULT_OFFICE_UI_SETTINGS.historyPageSize,
    liveRosterLimit: isAllowedNumber(candidate?.liveRosterLimit, LIVE_ROSTER_LIMIT_OPTIONS)
      ? candidate.liveRosterLimit
      : DEFAULT_OFFICE_UI_SETTINGS.liveRosterLimit,
    reducedMotion:
      typeof candidate?.reducedMotion === "boolean"
        ? candidate.reducedMotion
        : DEFAULT_OFFICE_UI_SETTINGS.reducedMotion,
    showAttentionInbox:
      typeof candidate?.showAttentionInbox === "boolean"
        ? candidate.showAttentionInbox
        : DEFAULT_OFFICE_UI_SETTINGS.showAttentionInbox,
    showOfflineHistoryByDefault:
      typeof candidate?.showOfflineHistoryByDefault === "boolean"
        ? candidate.showOfflineHistoryByDefault
        : DEFAULT_OFFICE_UI_SETTINGS.showOfflineHistoryByDefault,
    showOfficeTooltips:
      typeof candidate?.showOfficeTooltips === "boolean"
        ? candidate.showOfficeTooltips
        : DEFAULT_OFFICE_UI_SETTINGS.showOfficeTooltips,
    tooltipDetailLevel: isAllowedString(candidate?.tooltipDetailLevel, TOOLTIP_DETAIL_LEVEL_OPTIONS)
      ? candidate.tooltipDetailLevel
      : DEFAULT_OFFICE_UI_SETTINGS.tooltipDetailLevel,
  };
}

export function loadOfficeUiSettings(storage?: StorageLike): OfficeUiSettings {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return DEFAULT_OFFICE_UI_SETTINGS;
  }

  try {
    const raw = resolvedStorage.getItem(OFFICE_UI_SETTINGS_STORAGE_KEY);

    if (!raw) {
      return DEFAULT_OFFICE_UI_SETTINGS;
    }

    return sanitizeOfficeUiSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_OFFICE_UI_SETTINGS;
  }
}

export function saveOfficeUiSettings(settings: OfficeUiSettings, storage?: StorageLike): void {
  const resolvedStorage = resolveStorage(storage);

  if (!resolvedStorage) {
    return;
  }

  try {
    resolvedStorage.setItem(OFFICE_UI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence failures and keep the in-memory settings.
  }
}
