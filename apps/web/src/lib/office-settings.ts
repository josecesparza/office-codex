export const OFFICE_UI_SETTINGS_STORAGE_KEY = "office-codex.settings.v1";
export const LIVE_ROSTER_LIMIT_OPTIONS = [12, 20, 40] as const;
export const HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export interface OfficeUiSettings {
  historyPageSize: (typeof HISTORY_PAGE_SIZE_OPTIONS)[number];
  liveRosterLimit: (typeof LIVE_ROSTER_LIMIT_OPTIONS)[number];
  reducedMotion: boolean;
  showOfflineHistoryByDefault: boolean;
  showOfficeTooltips: boolean;
}

export const DEFAULT_OFFICE_UI_SETTINGS: OfficeUiSettings = {
  historyPageSize: 20,
  liveRosterLimit: 20,
  reducedMotion: false,
  showOfflineHistoryByDefault: false,
  showOfficeTooltips: true,
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

export function sanitizeOfficeUiSettings(value: unknown): OfficeUiSettings {
  const candidate =
    value && typeof value === "object" ? (value as Partial<OfficeUiSettings>) : undefined;

  return {
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
    showOfflineHistoryByDefault:
      typeof candidate?.showOfflineHistoryByDefault === "boolean"
        ? candidate.showOfflineHistoryByDefault
        : DEFAULT_OFFICE_UI_SETTINGS.showOfflineHistoryByDefault,
    showOfficeTooltips:
      typeof candidate?.showOfficeTooltips === "boolean"
        ? candidate.showOfficeTooltips
        : DEFAULT_OFFICE_UI_SETTINGS.showOfficeTooltips,
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
