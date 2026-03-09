import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface FileCursor {
  offset: number;
  remainder: string;
  ino: number | null;
  size: number;
}

export interface CursorStoreDiagnostics {
  entries: number;
  path: string;
  pendingWrite: boolean;
}

const EMPTY_CURSOR: FileCursor = {
  offset: 0,
  remainder: "",
  ino: null,
  size: 0,
};

export class CursorStore {
  readonly #path: string;
  readonly #cursors = new Map<string, FileCursor>();
  readonly #flushMs: number;
  #pendingWrite: Promise<void> | null = null;
  #flushTimer: NodeJS.Timeout | null = null;

  constructor(path: string, flushMs = 500) {
    this.#path = path;
    this.#flushMs = flushMs;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.#path, "utf8");
      const parsed = JSON.parse(raw) as Record<string, FileCursor>;

      for (const [filePath, cursor] of Object.entries(parsed)) {
        if (
          typeof cursor?.offset === "number" &&
          typeof cursor?.remainder === "string" &&
          (typeof cursor?.ino === "number" || cursor?.ino === null || cursor?.ino === undefined) &&
          (typeof cursor?.size === "number" || cursor?.size === undefined)
        ) {
          this.#cursors.set(filePath, {
            ino: cursor.ino ?? null,
            offset: cursor.offset,
            remainder: cursor.remainder,
            size: cursor.size ?? cursor.offset,
          });
        }
      }
    } catch {
      // Missing or malformed cursor state should not stop the daemon.
    }
  }

  get(filePath: string): FileCursor {
    return this.#cursors.get(filePath) ?? EMPTY_CURSOR;
  }

  set(filePath: string, cursor: FileCursor): void {
    this.#cursors.set(filePath, cursor);
    this.schedulePersist();
  }

  async persist(): Promise<void> {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }

    if (this.#pendingWrite) {
      return this.#pendingWrite;
    }

    this.#pendingWrite = (async () => {
      try {
        await mkdir(dirname(this.#path), { recursive: true });
        await writeFile(
          this.#path,
          JSON.stringify(Object.fromEntries(this.#cursors.entries()), null, 2),
          "utf8",
        );
      } catch {
        // Persisting offsets is best effort; runtime tracking still works in memory.
      } finally {
        this.#pendingWrite = null;
      }
    })();

    await this.#pendingWrite;
  }

  getDiagnostics(): CursorStoreDiagnostics {
    return {
      entries: this.#cursors.size,
      path: this.#path,
      pendingWrite: this.#pendingWrite !== null || this.#flushTimer !== null,
    };
  }

  schedulePersist(): void {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
    }

    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.persist();
    }, this.#flushMs);
    this.#flushTimer.unref();
  }
}
