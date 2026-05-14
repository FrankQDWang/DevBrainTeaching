export interface CodexIngestCliArgs {
  limit: number;
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid --limit ${raw}; expected an integer between 1 and 20.`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`Invalid --limit ${raw}; expected an integer between 1 and 20.`);
  }
  return value;
}

export function parseCodexIngestArgs(args: string[]): CodexIngestCliArgs {
  let limitRaw: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      limitRaw = args[index + 1];
      index += 1;
    } else if (arg?.startsWith("--limit=")) {
      limitRaw = arg.slice("--limit=".length);
    } else {
      throw new Error(`Unknown codex-ingest argument: ${arg}`);
    }
  }

  return { limit: parseLimit(limitRaw) };
}
