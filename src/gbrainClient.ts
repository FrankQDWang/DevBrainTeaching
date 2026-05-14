import { spawnSync } from "node:child_process";

const defaultGbrainCommand = "gbrain";

export interface CommandResult {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type GbrainRunner = (args: string[]) => CommandResult;

export class GbrainCommandError extends Error {
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    const command = result.command.join(" ");
    const details = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    super(`gbrain command failed: ${command}\n${details}`);
    this.name = "GbrainCommandError";
    this.result = result;
  }
}

export class InvalidGbrainJsonError extends Error {
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    super(`gbrain command did not return valid JSON: ${result.command.join(" ")}`);
    this.name = "InvalidGbrainJsonError";
    this.result = result;
  }
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

export interface GbrainClient {
  run(args: string[]): CommandResult;
  callTool<T>(args: string[]): T;
}

export function createGbrainClient(runner: GbrainRunner = runGbrain): GbrainClient {
  return {
    run(args: string[]): CommandResult {
      const result = runner(args);
      if (result.exitCode !== 0) {
        throw new GbrainCommandError(result);
      }
      return result;
    },

    callTool<T>(args: string[]): T {
      const result = this.run(args);
      try {
        return JSON.parse(result.stdout) as T;
      } catch {
        throw new InvalidGbrainJsonError(result);
      }
    },
  };
}

export function isGbrainCallable(): boolean {
  const result = runGbrain(["--version"]);
  return result.exitCode === 0;
}
