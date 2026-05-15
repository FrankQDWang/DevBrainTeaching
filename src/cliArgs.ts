export interface CodexCollectCliArgs {
  limit: number;
  dryRun: boolean;
  brainDir?: string;
}

export interface GbrainV5InitCliArgs {
  dryRun: boolean;
}

export type JinaV5ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status" | "plist";

export interface JinaV5ServiceCliArgs {
  action: JinaV5ServiceAction;
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid --limit ${raw}; expected an integer between 1 and 100.`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`Invalid --limit ${raw}; expected an integer between 1 and 100.`);
  }
  return value;
}

export function parseCodexCollectArgs(args: string[]): CodexCollectCliArgs {
  let limitRaw: string | undefined;
  let dryRun = false;
  let brainDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      limitRaw = args[index + 1];
      if (!limitRaw || limitRaw.startsWith("--")) {
        throw new Error("Invalid --limit; expected an integer between 1 and 100.");
      }
      index += 1;
    } else if (arg?.startsWith("--limit=")) {
      limitRaw = arg.slice("--limit=".length);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--brain-dir") {
      brainDir = args[index + 1];
      if (!brainDir || brainDir.startsWith("--")) throw new Error("Invalid --brain-dir; expected a path.");
      index += 1;
    } else if (arg?.startsWith("--brain-dir=")) {
      brainDir = arg.slice("--brain-dir=".length);
      if (!brainDir) throw new Error("Invalid --brain-dir; expected a path.");
    } else {
      throw new Error(`Unknown codex collect argument: ${arg}`);
    }
  }

  return { limit: parseLimit(limitRaw), dryRun, ...(brainDir ? { brainDir } : {}) };
}

export function parseGbrainV5InitArgs(args: string[]): GbrainV5InitCliArgs {
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown gbrain v5 init argument: ${arg}`);
    }
  }

  return { dryRun };
}

export function parseJinaV5ServiceArgs(args: string[]): JinaV5ServiceCliArgs {
  const action = args[0] ?? "status";
  if (args.length > 1) {
    throw new Error(`Unknown jina v5 service argument: ${args.slice(1).join(" ")}`);
  }
  if (!["install", "uninstall", "start", "stop", "restart", "status", "plist"].includes(action)) {
    throw new Error(`Unknown jina v5 service action: ${action}`);
  }
  return { action: action as JinaV5ServiceAction };
}
