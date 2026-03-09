import { spawn } from "node:child_process";
import { resolve } from "node:path";

import type { WrapperEvent } from "@office-codex/core";

const SESSION_ID_PATTERN = /\bsession id:\s*([0-9a-f-]+)/i;

function createLineParser(onLine: (line: string) => void) {
  let buffer = "";

  return {
    flush() {
      if (buffer.trim().length > 0) {
        onLine(buffer);
      }

      buffer = "";
    },
    push(chunk: Buffer | string) {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf("\n");

        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        onLine(line);
      }
    },
  };
}

async function postWrapperEvent(port: number, event: WrapperEvent): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/internal/wrapper-events`, {
      body: JSON.stringify(event),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch {
    // Wrapper hints are best effort. Codex should still run normally if the daemon is absent.
  }
}

export function detectSessionId(line: string): string | null {
  const match = line.match(SESSION_ID_PATTERN);
  return match?.[1] ?? null;
}

export function inferCodexWorkingDirectory(args: string[], fallback = process.cwd()): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-C" || arg === "--cd") {
      const candidate = args[index + 1];
      return candidate ? resolve(fallback, candidate) : fallback;
    }

    if (arg?.startsWith("--cd=")) {
      return resolve(fallback, arg.slice("--cd=".length));
    }
  }

  return fallback;
}

export async function runWrappedCodex(options: {
  args: string[];
  binary: string;
  cwd?: string;
  port: number;
}): Promise<void> {
  const baseCwd = options.cwd ?? process.cwd();
  const effectiveCwd = inferCodexWorkingDirectory(options.args, baseCwd);
  const startedAt = new Date().toISOString();
  const child = spawn(options.binary, options.args, {
    cwd: baseCwd,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  let sessionId: string | null = null;
  const onLine = (line: string) => {
    const detectedSessionId = detectSessionId(line);

    if (!detectedSessionId || sessionId || !child.pid) {
      return;
    }

    sessionId = detectedSessionId;
    void postWrapperEvent(options.port, {
      argv: options.args,
      cwd: effectiveCwd,
      pid: child.pid,
      sessionId: detectedSessionId,
      startedAt,
      type: "identified",
    });
  };
  const stdoutParser = createLineParser(onLine);
  const stderrParser = createLineParser(onLine);

  if (child.pid) {
    await postWrapperEvent(options.port, {
      argv: options.args,
      cwd: effectiveCwd,
      pid: child.pid,
      startedAt,
      type: "launch",
    });
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    stdoutParser.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    stderrParser.push(chunk);
  });

  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code) => {
      stdoutParser.flush();
      stderrParser.flush();
      resolveExit(code);
    });
  });

  if (child.pid) {
    const exitEvent: WrapperEvent = {
      exitCode,
      exitedAt: new Date().toISOString(),
      pid: child.pid,
      type: "exit",
    };

    if (sessionId) {
      exitEvent.sessionId = sessionId;
    }

    await postWrapperEvent(options.port, exitEvent);
  }

  if (exitCode !== 0) {
    const error = new Error(
      exitCode === null
        ? "Codex exited without an exit code"
        : `Codex exited with code ${exitCode}`,
    );
    throw error;
  }
}
