import { describe, expect, it } from "vitest";

import {
  DEFAULT_OFFICE_UI_SETTINGS,
  OFFICE_UI_SETTINGS_STORAGE_KEY,
  loadOfficeUiSettings,
  sanitizeOfficeUiSettings,
  saveOfficeUiSettings,
} from "./office-settings";

function createStorage(initialValue?: string) {
  const store = new Map<string, string>();

  if (initialValue !== undefined) {
    store.set(OFFICE_UI_SETTINGS_STORAGE_KEY, initialValue);
  }

  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("office-settings", () => {
  it("returns defaults when storage is missing", () => {
    expect(loadOfficeUiSettings()).toEqual(DEFAULT_OFFICE_UI_SETTINGS);
  });

  it("returns defaults when storage contains malformed json", () => {
    const storage = createStorage("{not-json");

    expect(loadOfficeUiSettings(storage)).toEqual(DEFAULT_OFFICE_UI_SETTINGS);
  });

  it("merges partial payloads over defaults", () => {
    const storage = createStorage(
      JSON.stringify({
        historyPageSize: 50,
        showOfficeTooltips: false,
      }),
    );

    expect(loadOfficeUiSettings(storage)).toEqual({
      ...DEFAULT_OFFICE_UI_SETTINGS,
      historyPageSize: 50,
      showOfficeTooltips: false,
    });
  });

  it("falls back to defaults for out-of-range values", () => {
    expect(
      sanitizeOfficeUiSettings({
        historyPageSize: 17,
        liveRosterLimit: 7,
        reducedMotion: true,
        showOfflineHistoryByDefault: true,
        showOfficeTooltips: "nope",
      }),
    ).toEqual({
      ...DEFAULT_OFFICE_UI_SETTINGS,
      reducedMotion: true,
      showOfflineHistoryByDefault: true,
    });
  });

  it("writes the sanitized settings payload back to storage", () => {
    const storage = createStorage();
    const next = {
      ...DEFAULT_OFFICE_UI_SETTINGS,
      liveRosterLimit: 40 as const,
    };

    saveOfficeUiSettings(next, storage);

    expect(storage.getItem(OFFICE_UI_SETTINGS_STORAGE_KEY)).toBe(JSON.stringify(next));
  });
});
