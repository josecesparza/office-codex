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
import {
  DEFAULT_DEMO_SECONDS,
  parseCommand,
  parseDemoLiveArgs,
  stripRunSeparator,
  wantsHelp,
} from "./command-helpers.js";

const HELP = `office-codex

Commands:
  dashboard           Start the local daemon on port ${DEFAULT_PORT}
  run -- [args...]    Launch Codex through the wrapper
  doctor              Validate local Codex sources
  demo-live           Launch a safe demo Codex session you can watch in the dashboard

Use \`office-codex <command> --help\` for command-specific usage.
`;

const DASHBOARD_HELP = `office-codex dashboard

Start the local Office Codex daemon on port ${DEFAULT_PORT}.
The daemon serves the dashboard API and, when built, the production web app.
`;

const RUN_HELP = `office-codex run -- [codex args...]

Launch Codex through the wrapper. Any remaining arguments are passed through to \`codex\`.

Examples:
  office-codex run -- --full-auto
  office-codex run -- exec "Summarize this repository"
`;

const DOCTOR_HELP = `office-codex doctor

Print local diagnostics for the Codex binary, ~/.codex, and the default dashboard ports.
`;

const DEMO_LIVE_HELP = `office-codex demo-live [options]

Launch a safe non-destructive Codex session so you can watch a live agent in Office Codex.
Run it from the repository or workspace you want to visualize.

Options:
  -s, --seconds <n>   Approximate total runtime in seconds (default: ${DEFAULT_DEMO_SECONDS})
  -h, --help          Show this help

Examples:
  office-codex demo-live
  office-codex demo-live --seconds 45
`;

function getHelp(command?: string): string {
  switch (command) {
    case "dashboard":
      return DASHBOARD_HELP;
    case "run":
      return RUN_HELP;
    case "doctor":
      return DOCTOR_HELP;
    case "demo-live":
      return DEMO_LIVE_HELP;
    default:
      return HELP;
  }
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

function buildDemoPrompt(seconds: number): string {
  const sleepSeconds = Math.max(5, seconds - 10);

  return [
    "Do not modify files.",
    `Spend about ${seconds} seconds total.`,
    "First run pwd and ls.",
    "If package.json exists, show its first 40 lines.",
    "Otherwise, if README.md exists, show its first 40 lines.",
    "If neither file exists, run ls -la.",
    `Then run sleep ${sleepSeconds}.`,
    "Finally, give one short sentence confirming what directory or repo this is.",
  ].join(" ");
}

async function runDemoLive(args: string[]): Promise<void> {
  const options = parseDemoLiveArgs(args);

  if (options.help) {
    console.log(DEMO_LIVE_HELP);
    return;
  }

  const binary = await resolveCodexBinary();

  if (!binary) {
    throw new Error("Unable to resolve the codex binary from PATH or the macOS app bundle");
  }

  await execa(binary, ["--full-auto", "exec", buildDemoPrompt(options.seconds)], {
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
    if (wantsHelp(parsed.args)) {
      console.log(DASHBOARD_HELP);
      break;
    }
    await runDashboard();
    break;
  case "run":
    if (wantsHelp(parsed.args)) {
      console.log(RUN_HELP);
      break;
    }
    await runCodex(parsed.args);
    break;
  case "doctor":
    if (wantsHelp(parsed.args)) {
      console.log(DOCTOR_HELP);
      break;
    }
    await runDoctor();
    break;
  case "demo-live":
    await runDemoLive(parsed.args);
    break;
  case "help":
    console.log(getHelp(parsed.args[0]));
    break;
  case "--help":
  case "-h":
    console.log(getHelp());
    break;
  default:
    console.error(`Unknown command: ${parsed.command}`);
    console.log(getHelp());
    process.exitCode = 1;
}
