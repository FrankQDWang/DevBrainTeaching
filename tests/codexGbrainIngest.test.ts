import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runCodexGbrainIngest } from "../src/codexGbrainIngest.js";
import type { CommandResult, GbrainRunner } from "../src/gbrainClient.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "codex-ingest-test-"));
}

function event(payload: unknown, timestamp = "2026-05-14T01:00:00.000Z"): string {
  return JSON.stringify({ timestamp, payload });
}

function writeSession(root: string, relativePath: string, id: string): string {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      event({ type: "session_meta", id, cwd: "/repo", model: "gpt-5.5", originator: "Codex" }),
      event({ type: "message", role: "user", content: [{ text: "Fix gbrain ingestion." }] }),
      event({ type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "bun test" }) }),
      event({ type: "function_call_output", output: "pass" }),
      event({ type: "message", role: "assistant", phase: "final", content: [{ text: "Done with verification." }] }),
    ].join("\n") + "\n",
  );
  return path;
}

function successfulRunner(calls: string[][]): GbrainRunner {
  return (args) => {
    calls.push(args);
    if (args.join(" ") === "sources list --json") {
      return ok(args, JSON.stringify({ sources: [] }));
    }
    if (args[0] === "call" && args[3] === "search") {
      return ok(args, JSON.stringify([{ slug: "transcripts/session-a", source_id: "codex-sessions" }]));
    }
    return ok(args);
  };
}

function ok(args: string[], stdout = ""): CommandResult {
  return { command: ["gbrain", ...args], exitCode: 0, stdout, stderr: "" };
}

function fail(args: string[], stderr = "failed"): CommandResult {
  return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr };
}

describe("codex gbrain ingest orchestration", () => {
  it("writes transcripts, manifest, registers source, syncs, embeds, and verifies", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const sourceRoot = join(root, ".devbrain-teaching/gbrain-sources/codex-sessions");
    const outputRoot = join(root, ".devbrain-teaching/runs");
    writeSession(sessionsDir, "2026/05/session-a.jsonl", "session-a");
    const calls: string[][] = [];

    const result = runCodexGbrainIngest({
      sessionsDir,
      sourceRoot,
      outputRoot,
      limit: 20,
      runner: successfulRunner(calls),
      isPathIgnored: () => true,
      now: () => new Date("2026-05-14T02:00:00.000Z"),
    });

    expect(result.transcriptsWritten).toBe(1);
    expect(existsSync(join(sourceRoot, "transcripts", "2026-05-14-session-a.md"))).toBe(true);
    expect(existsSync(join(result.runDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(result.runDir, "verification.md"))).toBe(true);
    expect(calls.map((args) => args.join(" "))).toContain("sync --source codex-sessions --no-pull");
    expect(calls.map((args) => args.join(" "))).toContain("embed --stale");
    expect(calls.map((args) => args.slice(0, 4).join(" "))).toContain("call --source codex-sessions search");
  });

  it("initializes the private generated source as a git repo before syncing", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const sourceRoot = join(root, "source");
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    runCodexGbrainIngest({
      sessionsDir,
      sourceRoot,
      outputRoot: join(root, "runs"),
      runner: successfulRunner([]),
      isPathIgnored: () => true,
    });

    expect(existsSync(join(sourceRoot, ".git"))).toBe(true);
    expect(spawnSync("git", ["-C", sourceRoot, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).status).toBe(0);
  });

  it("does not mistake an outer git repository for the generated source repository", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const sourceRoot = join(root, "nested", "source");
    writeSession(sessionsDir, "session-a.jsonl", "session-a");
    spawnSync("git", ["init", "-b", "main", root], { encoding: "utf8" });

    runCodexGbrainIngest({
      sessionsDir,
      sourceRoot,
      outputRoot: join(root, "runs"),
      runner: successfulRunner([]),
      isPathIgnored: () => true,
    });

    expect(existsSync(join(sourceRoot, ".git"))).toBe(true);
  });

  it("rejects invalid limits before discovery, writes, or gbrain calls", () => {
    for (const limit of [0, -1, 100000, Number.NaN]) {
      const root = tempRoot();
      const calls: string[][] = [];
      expect(() =>
        runCodexGbrainIngest({
          sessionsDir: join(root, "sessions"),
          sourceRoot: join(root, "source"),
          outputRoot: join(root, "runs"),
          limit,
          runner: successfulRunner(calls),
          isPathIgnored: () => true,
        }),
      ).toThrow(/Invalid --limit/);
      expect(calls).toEqual([]);
    }
  });

  it("refuses to write private transcripts when the generated source path is not ignored", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const sourceRoot = join(root, "source");
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    expect(() =>
      runCodexGbrainIngest({
        sessionsDir,
        sourceRoot,
        outputRoot: join(root, "runs"),
        runner: successfulRunner([]),
        isPathIgnored: () => false,
      }),
    ).toThrow(/not ignored by git/);
    expect(existsSync(join(sourceRoot, "transcripts"))).toBe(false);
  });

  it("sanitizes malicious session IDs before writing filenames", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const sourceRoot = join(root, "source");
    writeSession(sessionsDir, "session-a.jsonl", "../../evil");

    runCodexGbrainIngest({
      sessionsDir,
      sourceRoot,
      outputRoot: join(root, "runs"),
      runner: successfulRunner([]),
      isPathIgnored: () => true,
    });

    const files = readdirSync(join(sourceRoot, "transcripts"));
    expect(files).toEqual(["2026-05-14-evil.md"]);
    expect(existsSync(join(sourceRoot, "evil.md"))).toBe(false);
  });

  it("does not delete old transcripts when no session files are available", () => {
    const root = tempRoot();
    const sourceRoot = join(root, "source");
    mkdirSync(join(sourceRoot, "transcripts"), { recursive: true });
    writeFileSync(join(sourceRoot, "transcripts", "old.md"), "old");

    expect(() =>
      runCodexGbrainIngest({
        sessionsDir: join(root, "empty"),
        sourceRoot,
        outputRoot: join(root, "runs"),
        runner: successfulRunner([]),
        isPathIgnored: () => true,
      }),
    ).toThrow(/No Codex session JSONL files/);
    expect(readFileSync(join(sourceRoot, "transcripts", "old.md"), "utf8")).toBe("old");
  });

  it("writes verification failure artifacts when sync or embed fails", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    expect(() =>
      runCodexGbrainIngest({
        sessionsDir,
        sourceRoot: join(root, "source"),
        outputRoot: join(root, "runs"),
        runner: (args) => (args[0] === "embed" ? fail(args, "embed failed") : successfulRunner([])(args)),
        isPathIgnored: () => true,
        now: () => new Date("2026-05-14T02:00:00.000Z"),
      }),
    ).toThrow(/embed failed/);

    const runDir = join(root, "runs", "2026-05-14T02-00-00-000Z", "codex-sessions");
    expect(readFileSync(join(runDir, "verification.md"), "utf8")).toContain("gbrain-sync-embed");
    expect(JSON.parse(readFileSync(join(runDir, "verification.json"), "utf8")).status).toBe("failed");
  });

  it("treats gbrain soft sync blocks as failures even when exit code is zero", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    expect(() =>
      runCodexGbrainIngest({
        sessionsDir,
        sourceRoot: join(root, "source"),
        outputRoot: join(root, "runs"),
        runner: (args) => {
          if (args.join(" ") === "sources list --json") return ok(args, JSON.stringify({ sources: [] }));
          if (args[0] === "sync") return ok(args, "Full sync blocked: 3 file(s) failed");
          return ok(args);
        },
        isPathIgnored: () => true,
        now: () => new Date("2026-05-14T02:00:00.000Z"),
      }),
    ).toThrow(/Full sync blocked/);

    const runDir = join(root, "runs", "2026-05-14T02-00-00-000Z", "codex-sessions");
    expect(readFileSync(join(runDir, "verification.md"), "utf8")).toContain("gbrain-sync-embed");
  });

  it("rejects an existing codex-sessions source with unsafe metadata", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const calls: string[][] = [];
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    expect(() =>
      runCodexGbrainIngest({
        sessionsDir,
        sourceRoot: join(root, "source"),
        outputRoot: join(root, "runs"),
        runner: (args) => {
          calls.push(args);
          if (args.join(" ") === "sources list --json") {
            return ok(args, JSON.stringify({ sources: [{ id: "codex-sessions", local_path: "/wrong", federated: true }] }));
          }
          return ok(args);
        },
        isPathIgnored: () => true,
      }),
    ).toThrow(/local_path/);
    expect(calls.map((args) => args[0])).not.toContain("sync");
  });

  it("rechecks source metadata when add reports already exists", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    const sourceRoot = join(root, "source");
    const calls: string[][] = [];
    let listCount = 0;
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    runCodexGbrainIngest({
      sessionsDir,
      sourceRoot,
      outputRoot: join(root, "runs"),
      runner: (args) => {
        calls.push(args);
        if (args.join(" ") === "sources list --json") {
          listCount += 1;
          return ok(args, JSON.stringify({ sources: listCount === 1 ? [] : [{ id: "codex-sessions", local_path: sourceRoot, federated: false }] }));
        }
        if (args[0] === "sources" && args[1] === "add") return fail(args, "source already exists");
        if (args[0] === "call" && args[3] === "search") {
          return ok(args, JSON.stringify([{ slug: "transcripts/session-a", source_id: "codex-sessions" }]));
        }
        return ok(args);
      },
      isPathIgnored: () => true,
    });

    expect(calls.map((args) => args.join(" "))).toContain("sync --source codex-sessions --no-pull");
  });

  it("writes a failed verification report when fewer than three answers are usable", () => {
    const root = tempRoot();
    const sessionsDir = join(root, "sessions");
    writeSession(sessionsDir, "session-a.jsonl", "session-a");

    expect(() =>
      runCodexGbrainIngest({
        sessionsDir,
        sourceRoot: join(root, "source"),
        outputRoot: join(root, "runs"),
        runner: (args) => {
          if (args.join(" ") === "sources list --json") return ok(args, JSON.stringify({ sources: [] }));
          if (args[0] === "call" && args[3] === "search") return ok(args, JSON.stringify([]));
          return ok(args);
        },
        isPathIgnored: () => true,
        now: () => new Date("2026-05-14T02:00:00.000Z"),
      }),
    ).toThrow(/Verification failed/);

    const runDir = join(root, "runs", "2026-05-14T02-00-00-000Z", "codex-sessions");
    const verification = JSON.parse(readFileSync(join(runDir, "verification.json"), "utf8"));
    expect(verification.pass_count).toBe(0);
    expect(verification.passed).toBe(false);
  });
});
