export interface ParsedCommand {
  command: string;
  args: string[];
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
