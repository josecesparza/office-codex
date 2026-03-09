import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { execa } from "execa";

import {
  DEFAULT_PORT,
  DEFAULT_WEB_PORT,
  pathExists,
  resolveDaemonConfig,
  startDaemon,
} from "@office-codex/daemon";

interface ParsedCommand {
  command: string;
  args: string[];
}

const HELP = `office-codex

Commands:
  dashboard           Start the local daemon on port ${DEFAULT_PORT}
  run -- [args...]    Launch Codex through the wrapper
  doctor              Validate local Codex sources
`;

function parseCommand(argv: string[]): ParsedCommand {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [command = "dashboard", ...rest] = normalized;
  return {
    command,
    args: rest,
  };
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCodexBinary(): Promise<string | null> {
  const pathVariable = process.env.PATH ?? "";

  for (const segment of pathVariable.split(delimiter)) {
    const candidate = join(segment, "codex");
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  const fallback = "/Applications/Codex.app/Contents/Resources/codex";
  return (await isExecutable(fallback)) ? fallback : null;
}

function stripRunSeparator(args: string[]): string[] {
  if (args[0] === "--") {
    return args.slice(1);
  }

  return args;
}

async function runDashboard(): Promise<void> {
  const daemon = await startDaemon();
  console.log(`Office Codex daemon running at http://127.0.0.1:${daemon.config.port}`);
  console.log(`For web development, run the Vite UI on http://127.0.0.1:${DEFAULT_WEB_PORT}`);
}

async function runCodex(args: string[]): Promise<void> {
  const binary = await resolveCodexBinary();

  if (!binary) {
    throw new Error("Unable to resolve the codex binary from PATH or the macOS app bundle");
  }

  const runArgs = stripRunSeparator(args);
  const effectiveArgs =
    runArgs[0] === "codex" || runArgs[0] === binary ? runArgs.slice(1) : runArgs;

  await execa(binary, effectiveArgs, {
    stdio: "inherit",
  });
}

async function runDoctor(): Promise<void> {
  const config = resolveDaemonConfig();
  const binary = await resolveCodexBinary();
  const codexHomeExists = await pathExists(config.codexHome);
  const sessionIndexExists = await pathExists(join(config.codexHome, "session_index.jsonl"));
  const sessionsExists = await pathExists(join(config.codexHome, "sessions"));
  const output = {
    node: process.version,
    codexBinary: binary,
    codexHome: config.codexHome,
    codexHomeExists,
    sessionIndexExists,
    sessionsDirExists: sessionsExists,
    dashboardPort: config.port,
    defaultWebPort: DEFAULT_WEB_PORT,
    home: homedir(),
  };

  console.log(JSON.stringify(output, null, 2));
}

const parsed = parseCommand(process.argv.slice(2));

switch (parsed.command) {
  case "dashboard":
    await runDashboard();
    break;
  case "run":
    await runCodex(parsed.args);
    break;
  case "doctor":
    await runDoctor();
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${parsed.command}`);
    console.log(HELP);
    process.exitCode = 1;
}
