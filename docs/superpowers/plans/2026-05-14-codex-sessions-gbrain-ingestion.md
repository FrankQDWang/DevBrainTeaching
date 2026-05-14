# Codex Sessions GBrain Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe first slice that recursively imports the latest 20 Codex App sessions into a dedicated gbrain source as compact, searchable experience transcripts.

**Architecture:** Keep raw Codex JSONL as immutable provenance and generate normalized Markdown under the stable source directory `.devbrain-teaching/gbrain-sources/codex-sessions/transcripts/`. DevBrainTeaching shells out through the existing gbrain CLI boundary to register that stable directory as a non-federated gbrain source, sync/embed it, then writes run-scoped manifests and verification reports under `.devbrain-teaching/runs/<run-id>/`.

**Hardening Requirements:** This plan must not be implemented as a happy-path
importer. The first slice must validate `--limit` before discovery, confirm the
generated transcript source is ignored by git before writes, sanitize transcript
filenames, redact obvious secrets, enforce compact size budgets, never delete the
previous transcript snapshot before a new one is fully rendered, write
verification failure artifacts for sync/embed failures, and mark the run failed
unless at least three verification answers are usable.

**Tech Stack:** Bun, TypeScript, `node:fs`, `node:path`, `node:child_process`, Bun test, gbrain CLI.

**Spec:** [docs/superpowers/specs/2026-05-14-codex-sessions-gbrain-ingestion.md](../specs/2026-05-14-codex-sessions-gbrain-ingestion.md)

## Post-Implementation Notes

The implemented slice differs from early code snippets in this plan where real
`gbrain 0.33.1.0` behavior required correction:

- The local gbrain brain expects 1536-dimensional embeddings, so the Jina proxy,
  `.env.example`, README, and local `.env` use `1536` rather than earlier 1024
  examples.
- Source-scoped verification uses
  `gbrain call --source codex-sessions search '<json>'`; the plain
  `gbrain query --source ...` CLI form is not a valid source-scoped query
  boundary in the observed CLI.
- The generated source directory is initialized as its own private git repo and
  committed before `gbrain sync --source`, because sync requires a source-local
  `HEAD`.
- Latest-session discovery reads only a bounded file head to extract timestamps,
  avoiding full-file reads across the Codex JSONL corpus.

---

## File Structure

- Create `src/codexSessionParser.ts`: parse Codex JSONL into structured session summaries.
- Create `src/codexTranscriptWriter.ts`: render structured summaries into Markdown transcripts and a manifest.
- Create `src/codexGbrainIngest.ts`: orchestrate recursive session discovery, stable transcript source writing, gbrain source sync, embedding, and verification.
- Modify `src/gbrainClient.ts`: add reusable command error handling and a typed `GbrainClient.callTool`.
- Create `src/cliArgs.ts`: parse and validate CLI arguments shared by `src/index.ts`.
- Modify `src/index.ts`: add `codex-ingest` CLI command.
- Modify `package.json`: add `codex-ingest` script.
- Create `tests/codexSessionParser.test.ts`: parser filtering and malformed-line behavior.
- Create `tests/codexTranscriptWriter.test.ts`: Markdown and manifest rendering.
- Create `tests/codexGbrainIngest.test.ts`: orchestration using fake filesystem paths and fake gbrain runner.
- Create `tests/cliArgs.test.ts`: CLI limit validation, including non-numeric input.
- Modify `tests/gbrainClient.test.ts`: cover typed command errors and JSON parsing.

---

### Task 1: Strengthen The GBrain CLI Boundary

**Files:**
- Modify: `src/gbrainClient.ts`
- Modify: `tests/gbrainClient.test.ts`

- [ ] **Step 1: Add failing tests for typed gbrain calls**

Replace `tests/gbrainClient.test.ts` with:

```ts
import { describe, expect, it } from "bun:test";

import {
  GbrainCommandError,
  InvalidGbrainJsonError,
  createGbrainClient,
  isGbrainCallable,
} from "../src/gbrainClient.js";

describe("gbrain boundary", () => {
  it("keeps gbrain behind a callable CLI boundary", () => {
    expect(typeof isGbrainCallable()).toBe("boolean");
  });

  it("parses JSON tool output", () => {
    const client = createGbrainClient({
      run(command, args) {
        return {
          command: [command, ...args],
          exitCode: 0,
          stdout: JSON.stringify([{ slug: "codex-sessions/example" }]),
          stderr: "",
        };
      },
    });

    expect(client.callTool("list_pages", { limit: 1 })).toEqual([
      { slug: "codex-sessions/example" },
    ]);
  });

  it("throws a named error when gbrain exits non-zero", () => {
    const client = createGbrainClient({
      run(command, args) {
        return {
          command: [command, ...args],
          exitCode: 1,
          stdout: "",
          stderr: "Unknown tool: list_pages",
        };
      },
    });

    expect(() => client.callTool("list_pages", { limit: 1 })).toThrow(
      GbrainCommandError,
    );
  });

  it("throws a named error for invalid JSON", () => {
    const client = createGbrainClient({
      run(command, args) {
        return {
          command: [command, ...args],
          exitCode: 0,
          stdout: "not json",
          stderr: "",
        };
      },
    });

    expect(() => client.callTool("list_pages", { limit: 1 })).toThrow(
      InvalidGbrainJsonError,
    );
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test tests/gbrainClient.test.ts
```

Expected: FAIL because `createGbrainClient`, `GbrainCommandError`, and
`InvalidGbrainJsonError` do not exist yet.

- [ ] **Step 3: Implement the typed boundary**

Replace `src/gbrainClient.ts` with:

```ts
import { spawnSync } from "node:child_process";

const defaultGbrainCommand = "gbrain";

export interface CommandResult {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[]): CommandResult;
}

export class GbrainCommandError extends Error {
  constructor(public readonly result: CommandResult) {
    super(
      `gbrain command failed: ${result.command.join(" ")} (${result.exitCode}) ${result.stderr.trim()}`,
    );
    this.name = "GbrainCommandError";
  }
}

export class InvalidGbrainJsonError extends Error {
  constructor(
    public readonly result: CommandResult,
    public readonly cause: unknown,
  ) {
    super(`gbrain returned invalid JSON: ${result.command.join(" ")}`);
    this.name = "InvalidGbrainJsonError";
  }
}

export class GbrainClient {
  constructor(
    private readonly runner: CommandRunner,
    private readonly command = process.env.GBRAIN_BIN ?? defaultGbrainCommand,
  ) {}

  version(): string {
    return this.run(["--version"]).stdout.trim();
  }

  run(args: string[]): CommandResult {
    const result = this.runner.run(this.command, args);
    if (result.exitCode !== 0) {
      throw new GbrainCommandError(result);
    }
    return result;
  }

  callTool<T>(toolName: string, params: Record<string, unknown>): T {
    const result = this.run(["call", toolName, JSON.stringify(params)]);
    try {
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      throw new InvalidGbrainJsonError(result, error);
    }
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

export function createGbrainClient(
  runner: CommandRunner = { run: (_, args) => runGbrain(args) },
): GbrainClient {
  return new GbrainClient(runner);
}

export function isGbrainCallable(): boolean {
  try {
    createGbrainClient().version();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun test tests/gbrainClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gbrainClient.ts tests/gbrainClient.test.ts
git commit -m "feat: add typed gbrain cli boundary"
```

---

### Task 2: Parse Codex Session JSONL Into Structured Summaries

**Files:**
- Create: `src/codexSessionParser.ts`
- Create: `tests/codexSessionParser.test.ts`

- [ ] **Step 1: Write parser tests**

Create `tests/codexSessionParser.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { parseCodexSessionJsonl } from "../src/codexSessionParser.js";

describe("codex session parser", () => {
  it("keeps user goals, assistant outcomes, command summaries, and provenance", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-05-14T01:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "session-1",
          cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
          model: "gpt-5.5",
          originator: "Codex Desktop",
          base_instructions: { text: "large prompt that should be dropped" },
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-14T01:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "请检查 embedding API 是否可用" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-14T01:02:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "bun run jina-smoke" }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-14T01:02:30.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "Chunk ID: abc\nProcess exited with code 0\nOutput:\nJina smoke test OK: 1024 dims",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-14T01:03:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final",
          content: [{ type: "output_text", text: "Jina smoke test OK: 1024 dims" }],
        },
      }),
    ].join("\n");

    const parsed = parseCodexSessionJsonl({
      path: "/Users/frankqdwang/.codex/sessions/example.jsonl",
      content: jsonl,
    });

    expect(parsed.sessionId).toBe("session-1");
    expect(parsed.cwd).toBe("/Users/frankqdwang/Agents/DevBrainTeaching");
    expect(parsed.userGoals).toEqual(["请检查 embedding API 是否可用"]);
    expect(parsed.commands).toEqual(["bun run jina-smoke"]);
    expect(parsed.commandResults).toEqual([
      {
        callId: "call-1",
        command: "bun run jina-smoke",
        exitCode: 0,
        outputSummary: "Jina smoke test OK: 1024 dims",
      },
    ]);
    expect(parsed.outcomes.join("\n")).toContain("Jina smoke test OK: 1024 dims");
    expect(parsed.dropped.lowSignalEvents).toBeGreaterThan(0);
  });

  it("counts malformed JSONL lines without failing the whole session", () => {
    const parsed = parseCodexSessionJsonl({
      path: "/Users/frankqdwang/.codex/sessions/bad.jsonl",
      content: "{bad json}\n" + JSON.stringify({
        timestamp: "2026-05-14T01:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-2", cwd: "/tmp/work", model: "gpt-5.5" },
      }),
    });

    expect(parsed.sessionId).toBe("session-2");
    expect(parsed.dropped.malformedLines).toBe(1);
  });

  it("drops encrypted reasoning and developer instructions", () => {
    const parsed = parseCodexSessionJsonl({
      path: "/Users/frankqdwang/.codex/sessions/noise.jsonl",
      content: [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "session-3",
            cwd: "/tmp/work",
            model: "gpt-5.5",
            developer_instructions: "drop this",
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "reasoning",
            encrypted_content: "drop this too",
          },
        }),
      ].join("\n"),
    });

    expect(JSON.stringify(parsed)).not.toContain("drop this");
    expect(JSON.stringify(parsed)).not.toContain("encrypted_content");
  });

  it("redacts secrets from messages, commands, and command outputs", () => {
    const parsed = parseCodexSessionJsonl({
      path: "/Users/frankqdwang/.codex/sessions/secrets.jsonl",
      content: [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "session-4", cwd: "/tmp/work", model: "gpt-5.5" },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "JINA_API_KEY=jina_secret_1234567890 run smoke" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call-secret",
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "JINA_API_KEY=jina_secret_1234567890 bun run jina-smoke" }),
          },
        }),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-secret",
            output: "Process exited with code 0\nOutput:\nBearer abc.def.ghi",
          },
        }),
      ].join("\n"),
    });

    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("jina_secret_1234567890");
    expect(serialized).not.toContain("abc.def.ghi");
    expect(serialized).toContain("[REDACTED_SECRET]");
    expect(parsed.dropped.secretsRedacted).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test tests/codexSessionParser.test.ts
```

Expected: FAIL because `src/codexSessionParser.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/codexSessionParser.ts`:

```ts
import { createHash } from "node:crypto";

export interface ParseCodexSessionInput {
  path: string;
  content: string;
}

export interface ParsedCodexSession {
  sessionId: string;
  sourcePath: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  startedAt?: string;
  cwd?: string;
  model?: string;
  originator?: string;
  userGoals: string[];
  assistantNotes: string[];
  commands: string[];
  commandResults: Array<{
    callId: string;
    command: string;
    exitCode: number | null;
    outputSummary: string;
  }>;
  outcomes: string[];
  filePaths: string[];
  dropped: {
    malformedLines: number;
    lowSignalEvents: number;
    textFieldsTruncated: number;
    secretsRedacted: number;
  };
}

const MAX_TEXT_FIELD_CHARS = 2000;
const MAX_USER_GOALS = 6;
const MAX_ASSISTANT_NOTES = 12;
const MAX_OUTCOMES = 6;
const MAX_COMMAND_RESULTS = 30;
const MAX_FILE_PATHS = 80;

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|JINA_API_KEY)=\S+/g,
  /https?:\/\/[^:\s]+:[^@\s]+@/g,
];

function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let redacted = text;
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, () => {
      count += 1;
      return "[REDACTED_SECRET]";
    });
  }
  return { text: redacted, count };
}

function boundedText(text: string, dropped: ParsedCodexSession["dropped"]): string {
  const redacted = redactSecrets(text);
  dropped.secretsRedacted += redacted.count;
  if (redacted.text.length <= MAX_TEXT_FIELD_CHARS) return redacted.text;
  dropped.textFieldsTruncated += 1;
  return `${redacted.text.slice(0, MAX_TEXT_FIELD_CHARS)}...[TRUNCATED]`;
}

function textFromContent(content: unknown, dropped: ParsedCodexSession["dropped"]): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const text = record.text;
      return typeof text === "string" ? boundedText(text, dropped) : "";
    })
    .filter((text) => text.length > 0);
}

function extractCommand(payload: Record<string, unknown>, dropped: ParsedCodexSession["dropped"]): { callId: string; command: string } | null {
  if (payload.type !== "function_call") return null;
  const args = payload.arguments;
  if (typeof args !== "string") return null;
  try {
    const parsed = JSON.parse(args) as { cmd?: unknown };
    const callId = typeof payload.call_id === "string" ? payload.call_id : "";
    return typeof parsed.cmd === "string" ? { callId, command: boundedText(parsed.cmd, dropped) } : null;
  } catch {
    return null;
  }
}

function extractCommandOutput(payload: Record<string, unknown>, dropped: ParsedCodexSession["dropped"]): { callId: string; exitCode: number | null; outputSummary: string } | null {
  if (payload.type !== "function_call_output") return null;
  const callId = typeof payload.call_id === "string" ? payload.call_id : "";
  const output = typeof payload.output === "string" ? payload.output : "";
  const exitMatch = /Process exited with code (-?\d+)/.exec(output);
  const outputStart = output.indexOf("Output:");
  const body = boundedText(outputStart >= 0 ? output.slice(outputStart + "Output:".length).trim() : output.trim(), dropped);
  return {
    callId,
    exitCode: exitMatch ? Number.parseInt(exitMatch[1] ?? "", 10) : null,
    outputSummary: body.split(/\r?\n/).filter(Boolean).slice(0, 3).join("\n").slice(0, 1000),
  };
}

function extractPaths(text: string): string[] {
  const matches = text.match(/\/Users\/frankqdwang\/[^\s`)"']+/g) ?? [];
  return matches.map((match) => match.replace(/[.,;:]$/, ""));
}

function stableUnique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseCodexSessionJsonl(input: ParseCodexSessionInput): ParsedCodexSession {
  let sessionId = "";
  let startedAt: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let originator: string | undefined;
  const dropped = {
    malformedLines: 0,
    lowSignalEvents: 0,
    textFieldsTruncated: 0,
    secretsRedacted: 0,
  };

  const userGoals: string[] = [];
  const assistantNotes: string[] = [];
  const commands: string[] = [];
  const commandByCallId = new Map<string, string>();
  const commandResults: ParsedCodexSession["commandResults"] = [];
  const outcomes: string[] = [];
  const filePaths: string[] = [];

  for (const line of input.content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      dropped.malformedLines += 1;
      continue;
    }

    if (event.type === "session_meta") {
      const payload = event.payload as Record<string, unknown> | undefined;
      sessionId = typeof payload?.id === "string" ? payload.id : sessionId;
      startedAt = typeof event.timestamp === "string" ? event.timestamp : startedAt;
      cwd = typeof payload?.cwd === "string" ? payload.cwd : cwd;
      model = typeof payload?.model === "string" ? payload.model : model;
      originator = typeof payload?.originator === "string" ? payload.originator : originator;
      dropped.lowSignalEvents += 1;
      continue;
    }

    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) {
      dropped.lowSignalEvents += 1;
      continue;
    }

    if (payload.type === "reasoning" || "encrypted_content" in payload) {
      dropped.lowSignalEvents += 1;
      continue;
    }

    const command = extractCommand(payload, dropped);
    if (command) {
      commands.push(command.command);
      if (command.callId) commandByCallId.set(command.callId, command.command);
      filePaths.push(...extractPaths(command.command));
      continue;
    }

    const commandOutput = extractCommandOutput(payload, dropped);
    if (commandOutput) {
      commandResults.push({
        callId: commandOutput.callId,
        command: commandByCallId.get(commandOutput.callId) ?? "",
        exitCode: commandOutput.exitCode,
        outputSummary: commandOutput.outputSummary,
      });
      continue;
    }

    if (payload.type !== "message") {
      dropped.lowSignalEvents += 1;
      continue;
    }

    const role = payload.role;
    const texts = textFromContent(payload.content, dropped);
    if (role === "user") {
      userGoals.push(...texts);
      texts.forEach((text) => filePaths.push(...extractPaths(text)));
      continue;
    }
    if (role === "assistant") {
      const phase = payload.phase;
      if (phase === "final") {
        outcomes.push(...texts);
      } else if (phase === "commentary") {
        assistantNotes.push(...texts);
      } else {
        dropped.lowSignalEvents += 1;
        continue;
      }
      texts.forEach((text) => filePaths.push(...extractPaths(text)));
      continue;
    }

    dropped.lowSignalEvents += 1;
  }

  const fallbackId = input.path.split("/").pop()?.replace(/\.jsonl$/, "") ?? "unknown-session";

  return {
    sessionId: sessionId || fallbackId,
    sourcePath: input.path,
    sourceSha256: createHash("sha256").update(input.content).digest("hex"),
    sourceSizeBytes: Buffer.byteLength(input.content),
    ...(startedAt ? { startedAt } : {}),
    ...(cwd ? { cwd } : {}),
    ...(model ? { model } : {}),
    ...(originator ? { originator } : {}),
    userGoals: stableUnique(userGoals).slice(0, MAX_USER_GOALS),
    assistantNotes: stableUnique(assistantNotes).slice(0, MAX_ASSISTANT_NOTES),
    commands: stableUnique(commands),
    commandResults: commandResults.slice(0, MAX_COMMAND_RESULTS),
    outcomes: stableUnique(outcomes).slice(0, MAX_OUTCOMES),
    filePaths: stableUnique(filePaths).slice(0, MAX_FILE_PATHS),
    dropped,
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun test tests/codexSessionParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codexSessionParser.ts tests/codexSessionParser.test.ts
git commit -m "feat: parse codex session transcripts"
```

---

### Task 3: Render Transcripts And Manifest

**Files:**
- Create: `src/codexTranscriptWriter.ts`
- Create: `tests/codexTranscriptWriter.test.ts`

- [ ] **Step 1: Write writer tests**

Create `tests/codexTranscriptWriter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { renderCodexTranscript, renderCodexManifest } from "../src/codexTranscriptWriter.js";
import type { ParsedCodexSession } from "../src/codexSessionParser.js";

const session: ParsedCodexSession = {
  sessionId: "019e-test",
  sourcePath: "/Users/frankqdwang/.codex/sessions/example.jsonl",
  sourceSha256: "abc123",
  sourceSizeBytes: 1234,
  startedAt: "2026-05-14T01:00:00.000Z",
  cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
  model: "gpt-5.5",
  originator: "Codex Desktop",
  userGoals: ["请检查 embedding API 是否可用"],
  assistantNotes: ["我会读项目配置并跑 smoke test。"],
  commands: ["bun run jina-smoke"],
  commandResults: [{
    callId: "call-1",
    command: "bun run jina-smoke",
    exitCode: 0,
    outputSummary: "Jina smoke test OK: 1024 dims",
  }],
  outcomes: ["Jina smoke test OK: 1024 dims"],
  filePaths: ["/Users/frankqdwang/Agents/DevBrainTeaching/src/jinaProxy.ts"],
  dropped: { malformedLines: 0, lowSignalEvents: 3, textFieldsTruncated: 0, secretsRedacted: 0 },
};

describe("codex transcript writer", () => {
  it("renders gbrain-friendly markdown with provenance frontmatter", () => {
    const markdown = renderCodexTranscript(session);

    expect(markdown).toContain("type: codex-session");
    expect(markdown).toContain("schema_version: 1");
    expect(markdown).toContain('session_id: "019e-test"');
    expect(markdown).toContain("## User Goal");
    expect(markdown).toContain("## Decisions And Tradeoffs");
    expect(markdown).toContain("## Reusable Lessons");
    expect(markdown).toContain("bun run jina-smoke");
    expect(markdown).toContain("Jina smoke test OK: 1024 dims");
    expect(markdown).not.toContain("encrypted_content");
  });

  it("renders a compact manifest", () => {
    const manifest = renderCodexManifest({
      runId: "run-1",
      generatedAt: "2026-05-14T02:00:00.000Z",
      sourceRoot: "/Users/frankqdwang/.codex/sessions",
      limit: 20,
      sessions: [session],
    });

    expect(manifest.sessions).toEqual([
      {
        session_id: "019e-test",
        source_path: "/Users/frankqdwang/.codex/sessions/example.jsonl",
        source_sha256: "abc123",
        source_size_bytes: 1234,
        transcript_filename: "2026-05-14-019e-test.md",
        cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
        malformed_lines: 0,
        low_signal_events: 3,
        text_fields_truncated: 0,
        secrets_redacted: 0,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test tests/codexTranscriptWriter.test.ts
```

Expected: FAIL because `src/codexTranscriptWriter.ts` does not exist.

- [ ] **Step 3: Implement transcript rendering**

Create `src/codexTranscriptWriter.ts`:

```ts
import type { ParsedCodexSession } from "./codexSessionParser.js";

export interface CodexManifestInput {
  runId: string;
  generatedAt: string;
  sourceRoot: string;
  limit: number;
  sessions: ParsedCodexSession[];
}

export interface CodexManifest {
  run_id: string;
  generated_at: string;
  source_root: string;
  limit: number;
  sessions: Array<{
    session_id: string;
    source_path: string;
    transcript_filename: string;
    cwd?: string;
    source_sha256: string;
    source_size_bytes: number;
    malformed_lines: number;
    low_signal_events: number;
    text_fields_truncated: number;
    secrets_redacted: number;
  }>;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function datePrefix(session: ParsedCodexSession): string {
  return (session.startedAt ?? new Date().toISOString()).slice(0, 10);
}

export function safeSlug(value: string): string {
  const slug = value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 120);
  return slug || "unknown-session";
}

export function transcriptFilename(session: ParsedCodexSession): string {
  return `${datePrefix(session)}-${safeSlug(session.sessionId)}.md`;
}

function section(title: string, lines: string[]): string {
  if (lines.length === 0) return `## ${title}\n\nNone captured.\n`;
  return `## ${title}\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

const MAX_TRANSCRIPT_CHARS = 50000;

function capTranscript(markdown: string): string {
  if (markdown.length <= MAX_TRANSCRIPT_CHARS) return markdown;
  return `${markdown.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n## Parser Notes\n\n- Transcript hard cap reached.\n`;
}

export function renderCodexTranscript(session: ParsedCodexSession): string {
  const title = session.userGoals[0]?.slice(0, 80) ?? session.sessionId;
  const frontmatter = [
    "---",
    "type: codex-session",
    "schema_version: 1",
    "source: codex-app",
    `session_id: ${yamlString(session.sessionId)}`,
    `source_path: ${yamlString(session.sourcePath)}`,
    `source_sha256: ${yamlString(session.sourceSha256)}`,
    `source_size_bytes: ${session.sourceSizeBytes}`,
    ...(session.cwd ? [`cwd: ${yamlString(session.cwd)}`] : []),
    ...(session.startedAt ? [`started_at: ${yamlString(session.startedAt)}`] : []),
    ...(session.model ? [`model: ${yamlString(session.model)}`] : []),
    'parser_version: "codex-session-parser-v1"',
    'tags: ["codex-session"]',
    "---",
    "",
  ].join("\n");

  return capTranscript([
    frontmatter,
    `# Codex Session: ${title}`,
    "",
    section("User Goal", session.userGoals),
    section("Project Context", [
      ...(session.cwd ? [`CWD: ${session.cwd}`] : []),
      ...(session.originator ? [`Originator: ${session.originator}`] : []),
      ...(session.model ? [`Model: ${session.model}`] : []),
    ]),
    section("Key Events", session.assistantNotes),
    section("Decisions And Tradeoffs", session.assistantNotes.filter((line) => /decision|tradeoff|choose|because|决定|取舍/.test(line))),
    section("Errors And Root Causes", [
      ...session.commandResults.filter((result) => result.exitCode !== null && result.exitCode !== 0).map((result) => {
        const code = result.exitCode === null ? "unknown" : String(result.exitCode);
        return `\`${result.command || result.callId}\` failed with exit ${code}: ${result.outputSummary}`;
      }),
    ]),
    section("Verification", session.commandResults.map((result) => {
      const code = result.exitCode === null ? "unknown" : String(result.exitCode);
      return `\`${result.command || result.callId}\` -> exit ${code}: ${result.outputSummary}`;
    })),
    section("Outcome", session.outcomes),
    section("Reusable Lessons", session.outcomes.filter((line) => /lesson|reuse|next time|以后|经验|复用/.test(line))),
    section("Commands", session.commands.map((cmd) => `\`${cmd}\``)),
    section("Command Results", session.commandResults.map((result) => {
      const code = result.exitCode === null ? "unknown" : String(result.exitCode);
      return `\`${result.command || result.callId}\` -> exit ${code}: ${result.outputSummary}`;
    })),
    section("Referenced Files", session.filePaths.map((path) => `\`${path}\``)),
    section("Parser Notes", [
      `Malformed JSONL lines dropped: ${session.dropped.malformedLines}`,
      `Low-signal events dropped: ${session.dropped.lowSignalEvents}`,
      `Text fields truncated: ${session.dropped.textFieldsTruncated}`,
      `Secrets redacted: ${session.dropped.secretsRedacted}`,
    ]),
  ].join("\n").trimEnd() + "\n");
}

export function renderCodexManifest(input: CodexManifestInput): CodexManifest {
  return {
    run_id: input.runId,
    generated_at: input.generatedAt,
    source_root: input.sourceRoot,
    limit: input.limit,
    sessions: input.sessions.map((session) => ({
      session_id: session.sessionId,
      source_path: session.sourcePath,
      source_sha256: session.sourceSha256,
      source_size_bytes: session.sourceSizeBytes,
      transcript_filename: transcriptFilename(session),
      ...(session.cwd ? { cwd: session.cwd } : {}),
      malformed_lines: session.dropped.malformedLines,
      low_signal_events: session.dropped.lowSignalEvents,
      text_fields_truncated: session.dropped.textFieldsTruncated,
      secrets_redacted: session.dropped.secretsRedacted,
    })),
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun test tests/codexTranscriptWriter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codexTranscriptWriter.ts tests/codexTranscriptWriter.test.ts
git commit -m "feat: render codex transcripts"
```

---

### Task 4: Orchestrate Slice 1 Ingestion And Verification

**Files:**
- Create: `src/codexGbrainIngest.ts`
- Create: `tests/codexGbrainIngest.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write orchestration tests**

Create `tests/codexGbrainIngest.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";

import { runCodexGbrainIngest } from "../src/codexGbrainIngest.js";
import type { CommandRunner } from "../src/gbrainClient.js";

describe("codex gbrain ingest", () => {
  it("writes transcripts, registers source, syncs, embeds, and verifies", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const sessionsDir = join(root, "sessions");
    const datedSessionsDir = join(sessionsDir, "2026", "05", "14");
    const outputRoot = join(root, "runs");
    const sourceRoot = join(root, "gbrain-sources", "codex-sessions");
    mkdirSync(datedSessionsDir, { recursive: true });
    writeFileSync(join(datedSessionsDir, "rollout-2026-05-14T01-00-00-session-a.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-14T01:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a", model: "gpt-5.5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-14T01:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fix a gbrain embedding issue" }],
        },
      }),
    ].join("\n"));

    const calls: string[] = [];
    const runner: CommandRunner = {
      run(command, args) {
        calls.push([command, ...args].join(" "));
        if (args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        if (args[0] === "sources" && args[1] === "list") {
          return { command: [command, ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
        }
        if (args[0] === "query") {
          return { command: [command, ...args], exitCode: 0, stdout: "1 result: codex-sessions/session-a\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 0, stdout: "ok\n", stderr: "" };
      },
    };

    const result = runCodexGbrainIngest({
      sessionsDir,
      outputRoot,
      sourceRoot,
      limit: 20,
      runner,
      isPathIgnored: () => true,
      now: () => new Date("2026-05-14T02:00:00.000Z"),
    });

    expect(result.transcriptsWritten).toBe(1);
    expect(calls.some((call) => call.includes("sources add codex-sessions") && call.includes("--no-federated"))).toBe(true);
    expect(calls.some((call) => call.includes("sync --source codex-sessions --no-pull"))).toBe(true);
    expect(calls.some((call) => call.includes("embed --stale"))).toBe(true);
    expect(calls.some((call) => call.includes("query") && call.includes("--source codex-sessions"))).toBe(true);
    expect(readFileSync(result.manifestPath, "utf8")).toContain("session-a");
    expect(readFileSync(result.verificationMarkdownPath, "utf8")).toContain("Verification Questions");
    expect(result.runDir).toContain("codex-sessions");
  });

  function writeSession(root: string, id = "session-a") {
    const sessionsDir = join(root, "sessions");
    const datedSessionsDir = join(sessionsDir, "2026", "05", "14");
    mkdirSync(datedSessionsDir, { recursive: true });
    writeFileSync(join(datedSessionsDir, "rollout-2026-05-14T01-00-00-session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-14T01:00:00.000Z",
        type: "session_meta",
        payload: { id, cwd: "/repo/a", model: "gpt-5.5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-14T01:01:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fix a gbrain embedding issue" }],
        },
      }),
    ].join("\n"));
    return {
      sessionsDir,
      outputRoot: join(root, "runs"),
      sourceRoot: join(root, "gbrain-sources", "codex-sessions"),
    };
  }

  function successfulRunner(calls: string[], queryOutput = "source-backed codex-sessions evidence with concrete details"): CommandRunner {
    return {
      run(command, args) {
        calls.push([command, ...args].join(" "));
        if (args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        if (args[0] === "sources" && args[1] === "list") {
          return { command: [command, ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
        }
        if (args[0] === "query") {
          return { command: [command, ...args], exitCode: 0, stdout: queryOutput, stderr: "" };
        }
        return { command: [command, ...args], exitCode: 0, stdout: "ok\n", stderr: "" };
      },
    };
  }

  it("rejects invalid limits before discovery, writes, or gbrain calls", () => {
    const calls: string[] = [];
    const runner = successfulRunner(calls);
    for (const limit of [0, -1, 100000, Number.NaN]) {
      expect(() => runCodexGbrainIngest({
        sessionsDir: "/does/not/matter",
        outputRoot: "/tmp/unused-runs",
        sourceRoot: "/tmp/unused-source",
        limit,
        runner,
        isPathIgnored: () => true,
      })).toThrow("Invalid --limit");
    }
    expect(calls).toEqual([]);
  });

  it("refuses to write transcripts when the source path is not ignored", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const { sessionsDir, outputRoot, sourceRoot } = writeSession(root);
    expect(() => runCodexGbrainIngest({
      sessionsDir,
      outputRoot,
      sourceRoot,
      limit: 20,
      runner: successfulRunner([]),
      isPathIgnored: () => false,
    })).toThrow("not ignored by git");
    expect(existsSync(join(sourceRoot, "transcripts"))).toBe(false);
  });

  it("sanitizes unsafe session IDs before writing transcript filenames", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const { sessionsDir, outputRoot, sourceRoot } = writeSession(root, "../../evil");
    const result = runCodexGbrainIngest({
      sessionsDir,
      outputRoot,
      sourceRoot,
      limit: 20,
      runner: successfulRunner([]),
      isPathIgnored: () => true,
    });
    const filenames = readdirSync(result.transcriptDir);
    expect(filenames).toHaveLength(1);
    const filename = filenames[0] ?? "";
    expect(filename).not.toContain("..");
    expect(filename).toContain("evil");
  });

  it("does not delete the previous transcript snapshot when no sessions exist", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const sessionsDir = join(root, "empty-sessions");
    const outputRoot = join(root, "runs");
    const sourceRoot = join(root, "gbrain-sources", "codex-sessions");
    const oldTranscript = join(sourceRoot, "transcripts", "old.md");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(join(sourceRoot, "transcripts"), { recursive: true });
    writeFileSync(oldTranscript, "old transcript\n");
    expect(() => runCodexGbrainIngest({
      sessionsDir,
      outputRoot,
      sourceRoot,
      limit: 20,
      runner: successfulRunner([]),
      isPathIgnored: () => true,
    })).toThrow("No Codex session JSONL files");
    expect(readFileSync(oldTranscript, "utf8")).toBe("old transcript\n");
  });

  it("writes failure artifacts when version, sync, or embed fails", () => {
    for (const failingCommand of ["--version", "sync", "embed"]) {
      const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
      const { sessionsDir, outputRoot, sourceRoot } = writeSession(root);
      const runner: CommandRunner = {
        run(command, args) {
          if (args[0] === failingCommand) {
            return { command: [command, ...args], exitCode: 1, stdout: "", stderr: `${failingCommand} failed` };
          }
          if (args[0] === "--version") return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
          if (args[0] === "sources" && args[1] === "list") return { command: [command, ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
          return { command: [command, ...args], exitCode: 0, stdout: "ok\n", stderr: "" };
        },
      };
      expect(() => runCodexGbrainIngest({
        sessionsDir,
        outputRoot,
        sourceRoot,
        limit: 20,
        runner,
        isPathIgnored: () => true,
        now: () => new Date("2026-05-14T02:00:00.000Z"),
      })).toThrow();
      const runRoot = join(outputRoot, "2026-05-14T02-00-00-000Z", "codex-sessions");
      expect(readFileSync(join(runRoot, "verification.json"), "utf8")).toContain('"status": "failed"');
      expect(readFileSync(join(runRoot, "verification.md"), "utf8")).toContain(`${failingCommand} failed`);
    }
  });

  it("rejects an existing codex-sessions source with unsafe metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const { sessionsDir, outputRoot, sourceRoot } = writeSession(root);
    const calls: string[] = [];
    const runner: CommandRunner = {
      run(command, args) {
        calls.push([command, ...args].join(" "));
        if (args[0] === "--version") return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        if (args[0] === "sources" && args[1] === "list") {
          return { command: [command, ...args], exitCode: 0, stdout: JSON.stringify({ sources: [{ id: "codex-sessions", local_path: "/wrong/path", federated: true }] }), stderr: "" };
        }
        return { command: [command, ...args], exitCode: 0, stdout: "ok\n", stderr: "" };
      },
    };
    expect(() => runCodexGbrainIngest({ sessionsDir, outputRoot, sourceRoot, limit: 20, runner, isPathIgnored: () => true })).toThrow("/wrong/path");
    expect(calls.some((call) => call.includes("sync --source codex-sessions"))).toBe(false);
  });

  it("rechecks source metadata when add reports already exists", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const { sessionsDir, outputRoot, sourceRoot } = writeSession(root);
    let listCount = 0;
    const calls: string[] = [];
    const runner: CommandRunner = {
      run(command, args) {
        calls.push([command, ...args].join(" "));
        if (args[0] === "--version") return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        if (args[0] === "sources" && args[1] === "list") {
          listCount += 1;
          const sources = listCount === 1 ? [] : [{ id: "codex-sessions", local_path: sourceRoot, federated: false }];
          return { command: [command, ...args], exitCode: 0, stdout: JSON.stringify({ sources }), stderr: "" };
        }
        if (args[0] === "sources" && args[1] === "add") return { command: [command, ...args], exitCode: 1, stdout: "", stderr: "source already exists" };
        if (args[0] === "query") return { command: [command, ...args], exitCode: 0, stdout: "source-backed codex-sessions evidence with concrete details", stderr: "" };
        return { command: [command, ...args], exitCode: 0, stdout: "ok\n", stderr: "" };
      },
    };
    runCodexGbrainIngest({ sessionsDir, outputRoot, sourceRoot, limit: 20, runner, isPathIgnored: () => true });
    expect(listCount).toBe(2);
    expect(calls.some((call) => call.includes("sync --source codex-sessions"))).toBe(true);
  });

  it("writes failed verification artifacts when fewer than three answers are usable", () => {
    const root = mkdtempSync(join(tmpdir(), "codex-ingest-"));
    const { sessionsDir, outputRoot, sourceRoot } = writeSession(root);
    expect(() => runCodexGbrainIngest({
      sessionsDir,
      outputRoot,
      sourceRoot,
      limit: 20,
      runner: successfulRunner([], "No results"),
      isPathIgnored: () => true,
      now: () => new Date("2026-05-14T02:00:00.000Z"),
    })).toThrow("Only 0/5");
    const verificationJson = readFileSync(join(outputRoot, "2026-05-14T02-00-00-000Z", "codex-sessions", "verification.json"), "utf8");
    expect(verificationJson).toContain('"pass_count": 0');
    expect(verificationJson).toContain('"passed": false');
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test tests/codexGbrainIngest.test.ts
```

Expected: FAIL because `src/codexGbrainIngest.ts` does not exist.

- [ ] **Step 3: Implement orchestration**

Add this generated source directory to `.gitignore` before writing real
transcripts:

```gitignore
.devbrain-teaching/gbrain-sources/
```

Create `src/codexGbrainIngest.ts`:

```ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, sep } from "node:path";

import { parseCodexSessionJsonl } from "./codexSessionParser.js";
import {
  renderCodexManifest,
  renderCodexTranscript,
  transcriptFilename,
} from "./codexTranscriptWriter.js";
import { createGbrainClient, GbrainCommandError, type CommandRunner } from "./gbrainClient.js";

const defaultQuestions = [
  "What did I recently learn about using gbrain or embeddings with Codex?",
  "What recent Codex sessions involved DevBrain or DevBrainTeaching?",
  "What recurring verification commands do I run after UI or backend changes?",
  "What mistakes or failure modes appeared in recent Codex work?",
  "Which projects did I touch recently and what was the outcome?",
];

export interface CodexGbrainIngestOptions {
  sessionsDir?: string;
  outputRoot?: string;
  sourceRoot?: string;
  limit?: number;
  runner?: CommandRunner;
  isPathIgnored?: (path: string) => boolean;
  now?: () => Date;
}

export interface CodexGbrainIngestResult {
  runDir: string;
  transcriptDir: string;
  manifestPath: string;
  verificationJsonPath: string;
  verificationMarkdownPath: string;
  transcriptsWritten: number;
}

interface VerificationRow {
  question: string;
  output: string;
  usable: boolean;
  notes: string;
  follow_up: string | null;
}

type SourceRecord = {
  id?: string;
  type?: string;
  local_path?: string | null;
  federated?: boolean;
};

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error(`Invalid --limit ${String(limit)}; expected an integer between 1 and 20.`);
  }
  return limit;
}

function collectJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

function sessionSortTimestamp(path: string): number {
  const mtimeMs = statSync(path).mtimeMs;
  const preview = readFileSync(path, "utf8").split(/\r?\n/).slice(0, 50);
  for (const line of preview) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { timestamp?: unknown };
      if (typeof event.timestamp === "string") {
        const parsed = Date.parse(event.timestamp);
        if (!Number.isNaN(parsed)) return parsed;
      }
    } catch {
      continue;
    }
  }
  return mtimeMs;
}

function latestSessionFiles(dir: string, limit: number): string[] {
  if (!existsSync(dir)) {
    throw new Error(`Codex sessions directory does not exist: ${dir}`);
  }
  return collectJsonlFiles(dir)
    .map((path) => ({ path, sortKey: sessionSortTimestamp(path) }))
    .sort((a, b) => b.sortKey - a.sortKey || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) => item.path)
    .reverse();
}

function defaultIsPathIgnored(path: string): boolean {
  const check = spawnSync("git", ["check-ignore", "-q", path], { encoding: "utf8" });
  return check.status === 0;
}

function ensureIgnored(samplePath: string, isPathIgnored = defaultIsPathIgnored): void {
  if (!isPathIgnored(samplePath)) {
    throw new Error(
      `Refusing to write private Codex transcripts because ${samplePath} is not ignored by git. ` +
      "Add .devbrain-teaching/gbrain-sources/ to .gitignore first.",
    );
  }
}

function assertInsideDir(parent: string, child: string): void {
  const root = resolve(parent);
  const target = resolve(child);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refusing to write transcript outside transcript dir: ${target}`);
  }
}

function classifyQueryOutput(output: string): Omit<VerificationRow, "question" | "output"> {
  const text = output.trim();
  if (!text) {
    return { usable: false, notes: "Empty output.", follow_up: "Tighten ingestion or query wording." };
  }
  if (/no results|not found|nothing/i.test(text)) {
    return { usable: false, notes: "Query appears to have no useful result.", follow_up: "Inspect transcript quality and query terms." };
  }
  return { usable: text.length >= 20, notes: "Non-empty source-scoped result; needs human semantic review.", follow_up: null };
}

function renderVerificationMarkdown(rows: VerificationRow[], status = "completed"): string {
  const passCount = rows.filter((row) => row.usable).length;
  return [
    "# Codex Sessions GBrain Verification",
    "",
    `Status: ${status}`,
    `Pass count: ${passCount}/${rows.length}`,
    `Passed: ${passCount >= 3}`,
    "",
    "## Verification Questions",
    "",
    ...rows.flatMap((row, index) => [
      `### ${index + 1}. ${row.question}`,
      "",
      `Usable: ${row.usable}`,
      `Notes: ${row.notes}`,
      ...(row.follow_up ? [`Follow-up: ${row.follow_up}`] : []),
      "",
      "```text",
      row.output.trim() || "(empty output)",
      "```",
      "",
    ]),
  ].join("\n");
}

function renderFailureMarkdown(input: { generatedAt: string; stage: string; error: unknown }): string {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  return [
    "# Codex Sessions GBrain Verification",
    "",
    "Status: failed",
    `Generated at: ${input.generatedAt}`,
    `Failure stage: ${input.stage}`,
    "",
    "```text",
    message,
    "```",
    "",
  ].join("\n");
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = error instanceof GbrainCommandError ? error.result.stderr : "";
  return /already exists/i.test(`${message}\n${stderr}`);
}

function readSources(client: ReturnType<typeof createGbrainClient>): SourceRecord[] {
  const sourcesJson = client.run(["sources", "list", "--json"]).stdout;
  const parsed = JSON.parse(sourcesJson) as { sources?: SourceRecord[] };
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}

function validateExistingSource(source: SourceRecord | undefined, sourceRoot: string): void {
  if (!source) {
    throw new Error("gbrain source codex-sessions was expected but not found");
  }
  if (!source.local_path) {
    throw new Error("gbrain source codex-sessions has no local_path; expected a local transcript source");
  }
  if (resolve(source.local_path) !== sourceRoot) {
    throw new Error(`gbrain source codex-sessions points at ${source.local_path}; expected ${sourceRoot}`);
  }
  if (source.type && source.type !== "local") {
    throw new Error(`gbrain source codex-sessions has type ${source.type}; expected local`);
  }
  if (source.federated !== undefined && source.federated !== false) {
    throw new Error("gbrain source codex-sessions is federated; expected non-federated");
  }
}

function ensureCodexSource(client: ReturnType<typeof createGbrainClient>, sourceRoot: string): void {
  let existingSource = readSources(client).find((source) => source.id === "codex-sessions");
  if (existingSource) {
    validateExistingSource(existingSource, sourceRoot);
    return;
  }
  try {
    client.run(["sources", "add", "codex-sessions", "--path", sourceRoot, "--no-federated"]);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    existingSource = readSources(client).find((source) => source.id === "codex-sessions");
    validateExistingSource(existingSource, sourceRoot);
  }
}

function replaceTranscriptSnapshot(sourceRoot: string, transcriptDir: string, tempTranscriptDir: string, runId: string): void {
  mkdirSync(sourceRoot, { recursive: true });
  const backupDir = join(sourceRoot, `.transcripts.backup-${runId}`);
  rmSync(backupDir, { recursive: true, force: true });
  let backedUp = false;
  try {
    if (existsSync(transcriptDir)) {
      renameSync(transcriptDir, backupDir);
      backedUp = true;
    }
    renameSync(tempTranscriptDir, transcriptDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (backedUp && !existsSync(transcriptDir) && existsSync(backupDir)) {
      renameSync(backupDir, transcriptDir);
    }
    throw error;
  }
}

export function runCodexGbrainIngest(opts: CodexGbrainIngestOptions = {}): CodexGbrainIngestResult {
  const sessionsDir = opts.sessionsDir ?? "/Users/frankqdwang/.codex/sessions";
  const outputRoot = opts.outputRoot ?? ".devbrain-teaching/runs";
  const sourceRoot = resolve(opts.sourceRoot ?? ".devbrain-teaching/gbrain-sources/codex-sessions");
  const limit = validateLimit(opts.limit ?? 20);
  const now = opts.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const runId = generatedAt.replace(/[:.]/g, "-");
  const runDir = join(outputRoot, runId, "codex-sessions");
  const transcriptDir = join(sourceRoot, "transcripts");
  const tempTranscriptDir = join(sourceRoot, `.transcripts.tmp-${runId}`);
  mkdirSync(runDir, { recursive: true });
  const manifestPath = join(runDir, "manifest.json");
  const verificationJsonPath = join(runDir, "verification.json");
  const verificationMarkdownPath = join(runDir, "verification.md");

  const sampleTranscriptPath = join(transcriptDir, "example.md");
  ensureIgnored(sampleTranscriptPath, opts.isPathIgnored);

  const files = latestSessionFiles(sessionsDir, limit);
  if (files.length === 0) {
    throw new Error(`No Codex session JSONL files found in ${sessionsDir}`);
  }

  const sessions = files.map((path) => parseCodexSessionJsonl({
    path,
    content: readFileSync(path, "utf8"),
  }));

  rmSync(tempTranscriptDir, { recursive: true, force: true });
  mkdirSync(tempTranscriptDir, { recursive: true });
  for (const session of sessions) {
    const transcriptPath = resolve(tempTranscriptDir, transcriptFilename(session));
    assertInsideDir(tempTranscriptDir, transcriptPath);
    writeFileSync(transcriptPath, renderCodexTranscript(session));
  }
  replaceTranscriptSnapshot(sourceRoot, transcriptDir, tempTranscriptDir, runId);

  const manifest = renderCodexManifest({
    runId,
    generatedAt,
    sourceRoot: sessionsDir,
    limit,
    sessions,
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const writeFailure = (stage: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(verificationJsonPath, JSON.stringify({
      generated_at: generatedAt,
      status: "failed",
      stage,
      error: message,
    }, null, 2) + "\n");
    writeFileSync(verificationMarkdownPath, renderFailureMarkdown({ generatedAt, stage, error }));
  };

  const client = createGbrainClient(opts.runner);
  try {
    client.version();
    ensureCodexSource(client, sourceRoot);
    client.run(["sync", "--source", "codex-sessions", "--no-pull"]);
    client.run(["embed", "--stale"]);
  } catch (error) {
    writeFailure("gbrain-sync-embed", error);
    throw error;
  }

  let verification: VerificationRow[];
  try {
    verification = defaultQuestions.map((question) => {
      const output = client.run(["query", question, "--source", "codex-sessions"]).stdout;
      return { question, output, ...classifyQueryOutput(output) };
    });
  } catch (error) {
    writeFailure("verification-query", error);
    throw error;
  }
  const passCount = verification.filter((row) => row.usable).length;

  writeFileSync(verificationJsonPath, JSON.stringify({
    generated_at: generatedAt,
    status: passCount >= 3 ? "passed" : "failed",
    pass_count: passCount,
    passed: passCount >= 3,
    verification,
  }, null, 2) + "\n");
  writeFileSync(verificationMarkdownPath, renderVerificationMarkdown(verification, passCount >= 3 ? "passed" : "failed"));
  if (passCount < 3) {
    throw new Error(`Only ${passCount}/5 verification queries produced usable results`);
  }

  return {
    runDir,
    transcriptDir,
    manifestPath,
    verificationJsonPath,
    verificationMarkdownPath,
    transcriptsWritten: sessions.length,
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun test tests/codexGbrainIngest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore src/codexGbrainIngest.ts tests/codexGbrainIngest.test.ts
git commit -m "feat: ingest codex sessions into gbrain"
```

---

### Task 5: Wire The CLI And Verify End To End

**Files:**
- Create: `src/cliArgs.ts`
- Create: `tests/cliArgs.test.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add the CLI script**

Modify `package.json` so `scripts` includes:

```json
"codex-ingest": "bun run src/index.ts codex-ingest"
```

Keep the existing scripts unchanged.

- [ ] **Step 2: Add CLI limit parsing helper and tests**

Create `src/cliArgs.ts`:

```ts
export function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error(`Invalid --limit ${raw}; expected an integer between 1 and 20.`);
  }
  return value;
}
```

Create `tests/cliArgs.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { parseLimit } from "../src/cliArgs.js";

describe("CLI argument parsing", () => {
  it("defaults omitted --limit to the orchestrator default", () => {
    expect(parseLimit(undefined)).toBeUndefined();
  });

  it("accepts bounded integer limits", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("20")).toBe(20);
  });

  it("rejects non-numeric, zero, negative, fractional, and oversized limits", () => {
    for (const raw of ["abc", "0", "-1", "1.5", "100000"]) {
      expect(() => parseLimit(raw)).toThrow("Invalid --limit");
    }
  });
});
```

Run:

```bash
bun test tests/cliArgs.test.ts
```

Expected: PASS.

- [ ] **Step 3: Wire `codex-ingest` in `src/index.ts`**

Update `src/index.ts` so it imports and handles the new command:

```ts
#!/usr/bin/env bun

import { isGbrainCallable, runGbrain } from "./gbrainClient.js";
import { runCodexGbrainIngest } from "./codexGbrainIngest.js";
import { runJinaSmoke, startJinaProxy } from "./jinaProxy.js";
import { parseLimit } from "./cliArgs.js";

const command = process.argv[2] ?? "help";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (command === "doctor") {
  const version = runGbrain(["--version"]);
  if (version.exitCode !== 0) {
    console.error("gbrain CLI is not callable.");
    console.error(version.stderr.trim());
    process.exitCode = 1;
  } else {
    console.log(`gbrain callable: ${version.stdout.trim()}`);
  }
} else if (command === "candidates") {
  if (!isGbrainCallable()) {
    console.error("gbrain CLI is not callable; run from an environment where gbrain is on PATH.");
    process.exitCode = 1;
  } else {
    console.log("Candidate slice plan:");
    console.log("- read gbrain facts/takes/pages through CLI or MCP");
    console.log("- score only items with concrete event + decision + tradeoff + transferable principle");
    console.log("- write candidate review artifacts under .devbrain-teaching/runs/");
  }
} else if (command === "codex-ingest") {
  try {
    const limitRaw = valueAfter("--limit");
    const result = runCodexGbrainIngest({
      limit: parseLimit(limitRaw),
    });
    console.log(`Codex sessions ingested: ${result.transcriptsWritten}`);
    console.log(`Run directory: ${result.runDir}`);
    console.log(`Verification: ${result.verificationMarkdownPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "jina-proxy") {
  startJinaProxy();
} else if (command === "jina-smoke") {
  try {
    await runJinaSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.log("Usage:");
  console.log("  bun run doctor");
  console.log("  bun run candidates");
  console.log("  bun run codex-ingest -- --limit 20");
  console.log("  bun run jina-proxy");
  console.log("  bun run jina-smoke");
}
```

- [ ] **Step 4: Document the slice**

Add this section to `README.md`:

````markdown
## Codex Session Ingestion

The first gbrain ingestion slice keeps raw Codex App JSONL as provenance and
imports only normalized Markdown transcripts into a dedicated gbrain source.

```bash
bun run codex-ingest -- --limit 20
```

The command writes transcripts under `.devbrain-teaching/gbrain-sources/codex-sessions/`,
writes run reports under `.devbrain-teaching/runs/<run-id>/`, registers or
reuses the non-federated `codex-sessions` gbrain source, syncs it, embeds stale
pages, and runs five source-scoped verification queries.

The transcript source directory is generated from private Codex sessions and is
ignored by git via `.devbrain-teaching/gbrain-sources/`.
````

- [ ] **Step 5: Run all local tests**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 6: Run the existing doctor check**

Run:

```bash
bun run doctor
```

Expected: output includes `gbrain callable: gbrain 0.33.1.0`.

- [ ] **Step 7: Run the first real ingestion slice**

Run:

```bash
bun run codex-ingest -- --limit 20
```

Expected:

- It writes 20 or fewer transcripts.
- It writes `manifest.json`, `verification.json`, and `verification.md`.
- `.devbrain-teaching/gbrain-sources/` is ignored by git before transcript files
  are generated.
- Invalid limits such as `0`, `abc`, `-1`, and `100000` fail before discovery.
- Transcript filenames use sanitized session IDs and cannot escape the transcript
  directory.
- Sync/embed failures produce failure verification artifacts before non-zero
  exit.
- It registers or reuses the non-federated `codex-sessions` gbrain source.
- It completes sync, embedding, and verification queries.
- `verification.json` includes `pass_count`, `passed`, per-question `usable`,
  `notes`, and `follow_up` fields.

- [ ] **Step 8: Inspect the verification report**

Open the generated `verification.md` and confirm at least three verification
questions return relevant session evidence. If fewer than three are useful,
tighten parser filtering before increasing the ingestion limit.

- [ ] **Step 9: Capture gbrain stats**

Run:

```bash
gbrain stats
```

Expected: the page count is greater than the initial 1-page baseline observed
before this slice. Record the before/after values in the run notes.

- [ ] **Step 10: Commit**

```bash
git add .gitignore package.json README.md src/cliArgs.ts src/index.ts tests/cliArgs.test.ts
git commit -m "feat: wire codex session ingestion cli"
```

---

## Self-Review

Spec coverage:

- Safe JSONL parsing is covered by Task 2.
- Normalized Markdown transcripts and manifest are covered by Task 3.
- Dedicated `codex-sessions` source, sync, embed, and verification are covered
  by Task 4.
- CLI, docs, tests, and live verification are covered by Task 5.
- The gbrain boundary requirement is covered by Task 1.

Placeholder scan:

- The plan avoids deferred implementation language and gives concrete commands,
  expected outcomes, file paths, and code for each implementation step.

Type consistency:

- `ParsedCodexSession` is produced by `codexSessionParser.ts`, consumed by
  `codexTranscriptWriter.ts`, and used by `codexGbrainIngest.ts`.
- `CommandRunner`, `createGbrainClient`, and `GbrainClient.run` are defined in
  Task 1 before orchestration uses them in Task 4.

## Deferred Extensions

Do not include these in the first implementation slice unless the user opens a
separate planning gate:

- Structured experience cards alongside Markdown transcripts, with `goal`,
  `decision`, `failure`, `root_cause`, `fix`, `verification`, and
  `reusable_lesson` fields.
- Curated promotion queue from raw normalized `codex-sessions` into a separate
  long-term lessons source.
- Bilingual verification queries for Chinese user goals and English tool output.
- Incremental ingestion state keyed by session ID and source hash.
- Golden query regression tests for high-value lessons such as Jina dimensions,
  source isolation, and parser failure modes.
- Repository-specific verification habit summaries derived from command results.

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-05-14-codex-sessions-gbrain-ingestion.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh worker per task, review
   between tasks, fast iteration.
2. Inline Execution - execute tasks in this session using executing-plans, with
   checkpoints after each task.
