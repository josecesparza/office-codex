import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CursorStore } from "../src/cursor-store.js";

describe("CursorStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces cursor persistence and flushes on demand", async () => {
    vi.useFakeTimers();

    const root = await mkdtemp(join(tmpdir(), "office-codex-cursors-"));
    const path = join(root, "cursors.json");
    const store = new CursorStore(path, 500);

    store.set("/tmp/a.jsonl", {
      ino: 1,
      offset: 10,
      remainder: "",
      size: 10,
    });
    store.set("/tmp/b.jsonl", {
      ino: 2,
      offset: 20,
      remainder: "partial",
      size: 20,
    });

    await expect(readFile(path, "utf8")).rejects.toThrow();
    expect(store.getDiagnostics().pendingWrite).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    await store.persist();

    const contents = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      { ino: number; offset: number; remainder: string; size: number }
    >;

    expect(contents["/tmp/a.jsonl"]).toMatchObject({
      ino: 1,
      offset: 10,
      size: 10,
    });
    expect(contents["/tmp/b.jsonl"]).toMatchObject({
      ino: 2,
      offset: 20,
      remainder: "partial",
      size: 20,
    });
  });
});
