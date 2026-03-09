export interface ParsedCommand {
  command: string;
  args: string[];
}

export const DEFAULT_DEMO_SECONDS = 30;

export interface DemoLiveOptions {
  seconds: number;
  help: boolean;
}

export function parseCommand(argv: string[]): ParsedCommand {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [command = "dashboard", ...rest] = normalized;
  return {
    command,
    args: rest,
  };
}

export function stripRunSeparator(args: string[]): string[] {
  if (args[0] === "--") {
    return args.slice(1);
  }

  return args;
}

function parsePositiveInteger(label: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`Missing value for ${label}`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 5) {
    throw new Error(`${label} must be an integer greater than or equal to 5`);
  }

  return parsed;
}

export function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

export function parseDemoLiveArgs(args: string[]): DemoLiveOptions {
  const normalized = stripRunSeparator(args);
  let seconds = DEFAULT_DEMO_SECONDS;
  let help = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];

    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--seconds":
      case "-s":
        seconds = parsePositiveInteger(arg, normalized[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown demo-live option: ${arg}`);
    }
  }

  return {
    help,
    seconds,
  };
}
