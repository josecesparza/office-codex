import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface FileCursor {
  offset: number;
  remainder: string;
}

const EMPTY_CURSOR: FileCursor = {
  offset: 0,
  remainder: "",
};

export class CursorStore {
  readonly #path: string;
  readonly #cursors = new Map<string, FileCursor>();
  #pendingWrite: Promise<void> | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.#path, "utf8");
      const parsed = JSON.parse(raw) as Record<string, FileCursor>;

      for (const [filePath, cursor] of Object.entries(parsed)) {
        if (typeof cursor?.offset === "number" && typeof cursor?.remainder === "string") {
          this.#cursors.set(filePath, cursor);
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
    void this.persist();
  }

  async persist(): Promise<void> {
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
}
