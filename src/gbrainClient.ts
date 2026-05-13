import { spawnSync } from "node:child_process";

const defaultGbrainCommand = "gbrain";

export interface CommandResult {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runGbrain(args: string[]): CommandResult {
  const command = process.env.GBRAIN_BIN ?? defaultGbrainCommand;
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
  });

  return {
    command: [command, ...args],
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function isGbrainCallable(): boolean {
  const result = runGbrain(["--version"]);
  return result.exitCode === 0;
}
