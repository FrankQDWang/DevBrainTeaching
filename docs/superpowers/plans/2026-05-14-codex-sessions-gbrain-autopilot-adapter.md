# Codex Sessions GBrain Autopilot Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automation-ready Codex session collector that feeds gbrain's existing dream/autopilot mechanism instead of producing manual reports or direct gbrain sources.

**Architecture:** DevBrainTeaching owns deterministic collection, redaction, bounded transcript rendering, state, and readiness checks. GBrain owns synthesis, pages, facts, patterns, embeddings, and long-term memory through `gbrain dream` / `gbrain autopilot`.

**Tech Stack:** Bun, TypeScript, Bun test, `node:fs`, `node:path`, `node:child_process`, gbrain CLI.

**Spec:** [docs/superpowers/specs/2026-05-14-codex-sessions-gbrain-autopilot-adapter.md](../specs/2026-05-14-codex-sessions-gbrain-autopilot-adapter.md)

---

## File Structure

- Modify `src/index.ts`: add `codex-collect`, `gbrain-dream-check`, `codex-dream-cycle`; deprecate `codex-ingest`.
- Modify `package.json`: add new scripts and keep `codex-ingest` as a failing compatibility command.
- Modify `.gitignore`: ignore `.devbrain-teaching/dream-corpus/` and `.devbrain-teaching/state/`.
- Create `src/codexCollector.ts`: deterministic collection orchestration, state, atomic corpus writes.
- Modify `src/codexSessionParser.ts`: keep safe JSONL parsing; expose reusable parse result for corpus transcripts.
- Create `src/codexDreamTranscriptWriter.ts`: render gbrain-dream-oriented transcripts.
- Create `src/redaction.ts`: shared redaction and bounded text helpers.
- Create `src/gbrainDreamCheck.ts`: read-only gbrain readiness checks.
- Create `src/codexDreamCycle.ts`: collect + dry-run/full gbrain dream wrapper.
- Delete `src/codexGbrainIngest.ts`: remove the invalid direct gbrain source ingestion implementation.
- Create `tests/fixtures/codex-session-response-item.jsonl`: realistic response-item session.
- Create `tests/fixtures/codex-session-event-msg.jsonl`: realistic event-message session.
- Create `tests/fixtures/codex-session-large-tool-output.jsonl`: truncation fixture.
- Create `tests/fixtures/codex-session-reasoning-encrypted.jsonl`: privacy fixture.
- Create `tests/fixtures/codex-session-agents-block.jsonl`: boilerplate filtering fixture.
- Modify `README.md`: document new boundary and remove direct source ingestion instructions.
- Modify `docs/BOUNDARY.md`: clarify that Codex sessions are raw material for gbrain dream.
- Create `tests/redaction.test.ts`.
- Create `tests/codexCollector.test.ts`.
- Create `tests/codexDreamTranscriptWriter.test.ts`.
- Create `tests/gbrainDreamCheck.test.ts`.
- Create `tests/codexDreamCycle.test.ts`.
- Delete `tests/codexGbrainIngest.test.ts`: remove tests that keep the invalid route alive.
- Modify existing parser/CLI tests for the new command behavior.

---

## Task 1: Shared Redaction And Bounded Text

**Files:**
- Create: `src/redaction.ts`
- Create: `tests/redaction.test.ts`
- Modify: `src/codexSessionParser.ts`

- [ ] **Step 1: Write failing redaction tests**

Create `tests/redaction.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { boundText, redactText } from "../src/redaction.js";

describe("redaction", () => {
  it("redacts common secrets", () => {
    const input = [
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      "Authorization: Bearer abc.def.ghi",
      "github_pat_1234567890abcdefghijklmnopqrstuvwxyz",
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "xoxb-123-456-secret",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456",
      "JINA_API_KEY=jina_abcdefghijklmnopqrstuvwxyz123456",
      "STRIPE_SECRET_KEY=stripe-live-key-redacted-example",
      "GOOGLE_API_KEY=AIzaabcdefghijklmnopqrstuvwxyz123456",
      "GITLAB_TOKEN=glpat-abcdefghijklmnopqrstuvwxyz",
      "NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz",
      "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
      "AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz1234567890",
      "DATABASE_URL=postgres://user:pass@example.com/db",
      "REDIS_URL=redis://user:pass@example.com:6379/0",
      "-----BEGIN OPENSSH PRIVATE KEY-----\r\nsecret\r\n-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    const result = redactText(input);
    expect(result.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(result.text).not.toContain("abc.def.ghi");
    expect(result.text).not.toContain("github_pat_");
    expect(result.text).not.toContain("ghp_");
    expect(result.text).not.toContain("xoxb-");
    expect(result.text).not.toContain("sk-ant-");
    expect(result.text).not.toContain("jina_");
    expect(result.text).not.toContain("sk_live_");
    expect(result.text).not.toContain("AIza");
    expect(result.text).not.toContain("glpat-");
    expect(result.text).not.toContain("npm_");
    expect(result.text).not.toContain("AKIA");
    expect(result.text).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(result.text).not.toContain("user:pass@");
    expect(result.text).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(result.count).toBeGreaterThanOrEqual(15);
  });

  it("bounds text and reports truncation", () => {
    const result = boundText("abcdef", 3);
    expect(result.text).toBe("abc\n[TRUNCATED]");
    expect(result.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
bun test tests/redaction.test.ts
```

Expected: FAIL because `src/redaction.ts` does not exist.

- [ ] **Step 3: Implement shared redaction**

Create `src/redaction.ts`:

```ts
const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /npm_[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk_live_[A-Za-z0-9_-]{20,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*=\S+/gi,
  /[a-z]+:\/\/[^:\s]+:[^@\s]+@/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
];

export interface RedactionResult {
  text: string;
  count: number;
}

export interface BoundTextResult {
  text: string;
  truncated: boolean;
}

export function redactText(value: string): RedactionResult {
  let text = value;
  let count = 0;
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, () => {
      count += 1;
      return "[REDACTED_SECRET]";
    });
  }
  return { text, count };
}

export function boundText(value: string, maxChars: number): BoundTextResult {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: `${value.slice(0, maxChars)}\n[TRUNCATED]`, truncated: true };
}
```

- [ ] **Step 4: Use shared redaction in the parser**

Replace the parser-local secret patterns in `src/codexSessionParser.ts` with imports:

```ts
import { boundText, redactText } from "./redaction.js";
```

Update `redactSecrets` and `boundedText` to delegate:

```ts
function redactSecrets(value: string, dropped: CodexParserDropStats): string {
  const result = redactText(value);
  dropped.secretsRedacted += result.count;
  return result.text;
}

function boundedText(value: string, dropped: CodexParserDropStats): string {
  const redacted = redactSecrets(value, dropped).trim();
  const result = boundText(redacted, maxTextFieldChars);
  if (result.truncated) dropped.textFieldsTruncated += 1;
  return result.text;
}
```

- [ ] **Step 5: Verify**

Run:

```bash
bun test tests/redaction.test.ts tests/codexSessionParser.test.ts
```

Expected: PASS.

---

## Task 2: Render Dream-Oriented Transcript Corpus

**Files:**
- Create: `src/codexDreamTranscriptWriter.ts`
- Create: `tests/codexDreamTranscriptWriter.test.ts`

- [ ] **Step 1: Write failing writer tests**

Create `tests/codexDreamTranscriptWriter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import type { ParsedCodexSession } from "../src/codexSessionParser.js";
import { renderDreamTranscript, dreamTranscriptFilename } from "../src/codexDreamTranscriptWriter.js";

function session(): ParsedCodexSession {
  return {
    sourcePath: "/Users/frankqdwang/.codex/sessions/s.jsonl",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 123,
    sessionId: "../../bad",
    cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
    model: "gpt-5.5",
    originator: "Codex",
    startedAt: "2026-05-14T01:00:00.000Z",
    userGoals: ["Build a persistent gbrain adapter."],
    projectContext: ["CWD: /Users/frankqdwang/Agents/DevBrainTeaching"],
    keyEvents: ["Called exec_command: bun test"],
    assistantNotes: ["Decision: feed gbrain dream instead of manual reports."],
    commands: ["bun test"],
    commandResults: ["pass"],
    filePaths: ["/Users/frankqdwang/Agents/DevBrainTeaching/src/index.ts"],
    outcomes: ["Implemented and verified."],
    dropped: { malformedLines: 0, lowSignalEvents: 1, textFieldsTruncated: 0, secretsRedacted: 0 },
  };
}

describe("dream transcript writer", () => {
  it("renders raw material for gbrain dream without claiming final lessons", () => {
    const markdown = renderDreamTranscript(session());
    expect(markdown).toContain("type: codex-session-transcript");
    expect(markdown).toContain("dream_generated: false");
    expect(markdown).toContain("source_path_redacted: \"$HOME/.codex/sessions/s.jsonl\"");
    expect(markdown).toContain("cwd_redacted: \"$HOME/Agents/DevBrainTeaching\"");
    expect(markdown).toContain("## Reusable Raw Material");
    expect(markdown).toContain("## Trust Boundary");
    expect(markdown).not.toContain("promotion_ready");
    expect(markdown).not.toContain("/Users/frankqdwang");
  });

  it("sanitizes filenames", () => {
    expect(dreamTranscriptFilename(session())).toMatch(/^2026-05-14-bad-[a-f0-9]{8}\.txt$/);
  });
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
bun test tests/codexDreamTranscriptWriter.test.ts
```

Expected: FAIL because the writer does not exist.

- [ ] **Step 3: Implement dream transcript writer**

Create `src/codexDreamTranscriptWriter.ts` with:

```ts
import type { ParsedCodexSession } from "./codexSessionParser.js";
import { safeSlug } from "./codexTranscriptWriter.js";

const collectorVersion = "codex-session-collector-v1";
const maxTranscriptChars = 50_000;

function yaml(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

function redactLocalPathsInText(value: string): string {
  return value.replace(/\/Users\/frankqdwang\b/g, "$HOME");
}

function list(values: string[], fallback = "Not captured."): string {
  if (values.length === 0) return `- ${fallback}`;
  return values.map((value) => `- ${redactLocalPathsInText(value).replace(/\n/g, "\n  ")}`).join("\n");
}

function datePrefix(session: ParsedCodexSession): string {
  const parsed = session.startedAt ? Date.parse(session.startedAt) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "unknown-date";
}

function cap(markdown: string): string {
  if (markdown.length <= maxTranscriptChars) return markdown;
  return `${markdown.slice(0, maxTranscriptChars)}\n\n[TRANSCRIPT_TRUNCATED]\n`;
}

export function dreamTranscriptFilename(session: ParsedCodexSession): string {
  return `${datePrefix(session)}-${safeSlug(session.sessionId)}-${session.sourceSha256.slice(0, 8)}.txt`;
}

function redactHomePath(value: string | undefined): string {
  return (value ?? "").replace(/^\/Users\/frankqdwang\b/, "$HOME");
}

export function renderDreamTranscript(session: ParsedCodexSession): string {
  return cap(`---
type: codex-session-transcript
schema_version: 1
collector_version: ${yaml(collectorVersion)}
source: codex-app
session_id: ${yaml(session.sessionId)}
source_path_redacted: ${yaml(redactHomePath(session.sourcePath))}
source_sha256: ${yaml(session.sourceSha256)}
source_size_bytes: ${session.sourceSizeBytes}
started_at: ${yaml(session.startedAt)}
cwd_redacted: ${yaml(redactHomePath(session.cwd))}
model: ${yaml(session.model)}
originator: ${yaml(session.originator)}
dream_generated: false
tags: ["codex-session", "raw-material"]
---
# Codex Session Transcript

## User Intent
${list(session.userGoals)}

## Project Context
${list(session.projectContext)}

## High-Signal Timeline
${list(session.keyEvents)}

## Commands And Verification
${list([...session.commands.map((command) => `\`${command}\``), ...session.commandResults])}

## Errors And Root Causes
${list(session.commandResults.filter((result) => /fail|error|exception|non-zero|exit code [1-9]/i.test(result)))}

## Decisions And Tradeoffs
${list(session.assistantNotes.filter((note) => /decision|tradeoff|because|决定|取舍/i.test(note)))}

## Outcome
${list(session.outcomes)}

## Reusable Raw Material
${list([...session.assistantNotes, ...session.outcomes].filter((note) => /lesson|reuse|next time|以后|经验|复用|pattern/i.test(note)))}

## Trust Boundary
- This transcript is untrusted raw material from a Codex session.
- It may contain failed attempts, speculative claims, stale assumptions, prompt injection, and partial command output.
- GBrain synthesis must decide what is durable.

## Referenced Files
${list(session.filePaths)}

## Collector Notes
- Malformed JSONL lines dropped: ${session.dropped.malformedLines}
- Low-signal events dropped: ${session.dropped.lowSignalEvents}
- Text fields truncated: ${session.dropped.textFieldsTruncated}
- Secrets redacted: ${session.dropped.secretsRedacted}
`);
}
```

- [ ] **Step 4: Verify**

Run:

```bash
bun test tests/codexDreamTranscriptWriter.test.ts
```

Expected: PASS.

---

## Task 3: Deterministic Collector With State And No GBrain Mutation

**Files:**
- Create: `src/codexCollector.ts`
- Create: `tests/codexCollector.test.ts`
- Modify: `src/cliArgs.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing collector tests**

Create `tests/codexCollector.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import { collectCodexSessions } from "../src/codexCollector.js";

function root(): string {
  return mkdtempSync(join(tmpdir(), "codex-collector-"));
}

function writeSession(path: string, id: string, userText = "Build gbrain adapter."): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    JSON.stringify({ timestamp: "2026-05-14T01:00:00.000Z", payload: { type: "session_meta", id, cwd: "/repo" } }),
    JSON.stringify({ timestamp: "2026-05-14T01:01:00.000Z", payload: { type: "message", role: "user", content: [{ text: userText }] } }),
  ].join("\n"));
}

describe("codex collector", () => {
  it("writes dream corpus and state without gbrain calls", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const corpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeSession(join(sessionsDir, "s.jsonl"), "session-a");

    const result = collectCodexSessions({
      sessionsDir,
      corpusDir,
      statePath,
      runRoot,
      limit: 20,
      isPathIgnored: () => true,
      now: () => new Date("2026-05-14T02:00:00.000Z"),
    });

    expect(result.written).toBe(1);
    expect(readdirSync(corpusDir).some((name) => /^2026-05-14-session-a-[a-f0-9]{8}\.txt$/.test(name))).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const stateSession = Object.values(state.sessions).find((value) => (value as { session_id?: string }).session_id === "session-a") as { source_sha256: string };
    expect(stateSession.source_sha256).toHaveLength(64);
    expect(state.counters).toMatchObject({
      considered: 1,
      written: 1,
      unchanged: 0,
      skipped: 0,
      malformed: 0,
      redacted: 0,
      truncated: 0,
    });
    expect(existsSync(join(result.runDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(result.runDir, "report.md"))).toBe(true);
    expect(statSync(corpusDir).mode & 0o777).toBe(0o700);
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
    expect(statSync(join(result.runDir, "manifest.json")).mode & 0o777).toBe(0o600);
  });

  it("refuses writes when corpus path is not git ignored", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    writeSession(join(sessionsDir, "s.jsonl"), "session-a");

    expect(() => collectCodexSessions({
      sessionsDir,
      corpusDir: join(dir, "corpus"),
      statePath: join(dir, "state.json"),
      runRoot: join(dir, "runs"),
      limit: 20,
      isPathIgnored: () => false,
    })).toThrow(/not ignored by git/);
  });

  it("does not rewrite unchanged transcripts", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const corpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeSession(join(sessionsDir, "s.jsonl"), "session-a");

    collectCodexSessions({ sessionsDir, corpusDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const fileName = readdirSync(corpusDir)[0]!;
    const firstMtime = statSync(join(corpusDir, fileName)).mtimeMs;
    const second = collectCodexSessions({ sessionsDir, corpusDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const secondMtime = statSync(join(corpusDir, fileName)).mtimeMs;

    expect(second.unchanged).toBe(1);
    expect(secondMtime).toBe(firstMtime);
  });

  it("tracks sessions with the same session id but different source hashes independently", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const corpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeSession(join(sessionsDir, "a.jsonl"), "session-a", "First copy.");
    writeSession(join(sessionsDir, "b.jsonl"), "session-a", "Second copy with different hash.");

    const first = collectCodexSessions({ sessionsDir, corpusDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const second = collectCodexSessions({ sessionsDir, corpusDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const state = JSON.parse(readFileSync(statePath, "utf8"));

    expect(first.written).toBe(2);
    expect(second.unchanged).toBe(2);
    expect(Object.keys(state.sessions)).toHaveLength(2);
  });

  it("does not write state, reports, or corpus files when no sessions exist", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const corpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    const oldTranscript = join(corpusDir, "old.txt");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(corpusDir, { recursive: true });
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(oldTranscript, "old transcript");
    writeFileSync(statePath, JSON.stringify({ old: true }));
    const oldTranscriptMtime = statSync(oldTranscript).mtimeMs;
    const oldState = readFileSync(statePath, "utf8");

    expect(() => collectCodexSessions({
      sessionsDir,
      corpusDir,
      statePath,
      runRoot,
      limit: 20,
      isPathIgnored: () => true,
    })).toThrow(/no codex session files/i);

    expect(readFileSync(oldTranscript, "utf8")).toBe("old transcript");
    expect(statSync(oldTranscript).mtimeMs).toBe(oldTranscriptMtime);
    expect(readFileSync(statePath, "utf8")).toBe(oldState);
    expect(existsSync(runRoot)).toBe(false);
  });
});
```

Also add one repository-level ignore assertion, using the real repo `.gitignore` instead of a mock:

```ts
import { spawnSync } from "node:child_process";

it("keeps generated corpus, state, and run artifacts ignored by git", () => {
  for (const path of [
    ".devbrain-teaching/dream-corpus/codex-sessions/example.txt",
    ".devbrain-teaching/state/codex-sessions.json",
    ".devbrain-teaching/runs/example/manifest.json",
  ]) {
    const result = spawnSync("git", ["check-ignore", "-q", "--no-index", "--", path], {
      cwd: process.cwd(),
    });
    expect(result.status).toBe(0);
  }
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
bun test tests/codexCollector.test.ts
```

Expected: FAIL because the collector does not exist.

- [ ] **Step 3: Implement collector**

Create `src/codexCollector.ts` with these exported contracts:

```ts
export interface CollectCodexSessionsOptions {
  sessionsDir?: string;
  corpusDir?: string;
  statePath?: string;
  runRoot?: string;
  limit?: number;
  isPathIgnored?: (path: string) => boolean;
  now?: () => Date;
}

export interface CollectCodexSessionsResult {
  corpusDir: string;
  runDir: string;
  considered: number;
  written: number;
  unchanged: number;
  skipped: number;
}

export function collectCodexSessions(options?: CollectCodexSessionsOptions): CollectCodexSessionsResult;
```

Implementation requirements:

- Reuse `parseCodexSessionJsonl`.
- Reuse `renderDreamTranscript` and `dreamTranscriptFilename`.
- Update and reuse `parseLimit` validation so default is `20` and accepted range is `1..100`.
- Default `sessionsDir` to `join(homedir(), ".codex/sessions")`; tests may inject `sessionsDir`, but the CLI does not need a public `--sessions-dir` flag in this slice.
- Check `git check-ignore -q --no-index -- <actual-target>.txt`, state path, and run manifest path before writing by default.
- Update `.gitignore` to include:
  - `.devbrain-teaching/dream-corpus/`
  - `.devbrain-teaching/state/`
  - keep `.devbrain-teaching/runs/`
- Discover latest sessions by parsed timestamp, then mtime, then filename.
- If no session files are found, throw a clear error before writing state, reports, or corpus files.
- Do not replace the corpus directory. For each changed transcript, write `<target>.tmp-<pid>-<nonce>`, then rename it onto the target file.
- If a session fingerprint is unchanged, do not touch the existing transcript file.
- The state fingerprint must include source hash, parser version, renderer version, and redaction version.
- The state session key must include both session ID and source hash so distinct JSONL files with the same Codex session ID do not overwrite each other.
- The state file must include collection counters for `considered`, `written`, `unchanged`, `skipped`, `malformed`, `redacted`, and `truncated`.
- Write state to `.devbrain-teaching/state/codex-sessions.json` through temp-file + rename.
- Write run manifest and `report.md`.
- Set generated directories to `0700` and generated files to `0600` where supported.
- Do not import or call `gbrainClient`.

- [ ] **Step 4: Verify collector tests**

Run:

```bash
bun test tests/codexCollector.test.ts
```

Expected: PASS.

---

## Task 3.5: Real Codex JSONL Fixture Coverage

**Files:**
- Create: `tests/fixtures/codex-session-response-item.jsonl`
- Create: `tests/fixtures/codex-session-event-msg.jsonl`
- Create: `tests/fixtures/codex-session-large-tool-output.jsonl`
- Create: `tests/fixtures/codex-session-reasoning-encrypted.jsonl`
- Create: `tests/fixtures/codex-session-agents-block.jsonl`
- Modify: `tests/codexSessionParser.test.ts`

- [ ] **Step 1: Add representative fixtures**

Create fixture files with these behaviors:

- `codex-session-response-item.jsonl`: includes `response_item` records with `payload.type = "message"` and user/assistant roles.
- `codex-session-event-msg.jsonl`: includes `event_msg` with `payload.type = "user_message"` and a duplicated long user message.
- `codex-session-large-tool-output.jsonl`: includes a tool call and command output longer than the allowed preview.
- `codex-session-reasoning-encrypted.jsonl`: includes `reasoning`, `analysis`, and `encrypted_content`.
- `codex-session-agents-block.jsonl`: includes an AGENTS/environment block that must be dropped.

- [ ] **Step 2: Add parser assertions**

Append tests to `tests/codexSessionParser.test.ts` that load these fixtures and assert:

```ts
expect(JSON.stringify(parsed)).not.toContain("encrypted_content");
expect(JSON.stringify(parsed)).not.toContain("private reasoning");
expect(JSON.stringify(parsed)).not.toContain("# AGENTS.md instructions");
expect(parsed.dropped.textFieldsTruncated).toBeGreaterThan(0);
expect(parsed.userGoals.length).toBeGreaterThan(0);

const serialized = JSON.stringify(parsed);
const duplicateNeedle = "large duplicated user message unique marker";
expect(serialized.indexOf(duplicateNeedle)).toBe(serialized.lastIndexOf(duplicateNeedle));
```

Update parser logic so repeated high-signal text within the same session is deduplicated after redaction/truncation and before appending to `userGoals`, `projectContext`, `keyEvents`, `assistantNotes`, `commandResults`, or `outcomes`. Track dropped duplicates as `lowSignalEvents` unless a dedicated duplicate counter is added.

- [ ] **Step 3: Verify**

Run:

```bash
bun test tests/codexSessionParser.test.ts
```

Expected: PASS.

---

## Task 4: Read-Only GBrain Dream Readiness Check

**Files:**
- Create: `src/gbrainDreamCheck.ts`
- Create: `tests/gbrainDreamCheck.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Create `tests/gbrainDreamCheck.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkGbrainDreamReadiness } from "../src/gbrainDreamCheck.js";
import type { CommandResult, GbrainRunner } from "../src/gbrainClient.js";

function ok(args: string[], stdout = ""): CommandResult {
  return { command: ["gbrain", ...args], exitCode: 0, stdout, stderr: "" };
}

function fail(args: string[], stderr = "missing"): CommandResult {
  return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr };
}

describe("gbrain dream readiness", () => {
  it("reports missing dream config, model route, embedding config, and stale direct source", () => {
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "GBrain config:\n  embedding_model: litellm:jina-embeddings-v4\n  embedding_dimensions: 1536\n");
      if (args.join(" ") === "sources list --json") {
        return ok(args, JSON.stringify({ sources: [{ id: "codex-sessions", local_path: "/old", federated: false }] }));
      }
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const report = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", runner });
    expect(report.ready).toBe(false);
    expect(report.version).toBe("gbrain 0.33.1.0");
    expect(report.config.embedding_model).toBe("litellm:jina-embeddings-v4");
    expect(report.config.embedding_dimensions).toBe("1536");
    expect(report.corpus_dir_exists).toBe(false);
    expect(report.missing_config).toContain("dream.synthesize.session_corpus_dir");
    expect(report.command_errors.some((error) => error.stage.startsWith("config-get:"))).toBe(false);
    expect(report.warnings).toContain("sync.repo_path is not configured; pass --brain-dir to codex-dream-cycle or configure sync.repo_path before full dream runs.");
    expect(report.stale_sources).toHaveLength(1);
  });

  it("does not throw on malformed sources JSON", () => {
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "");
      if (args.join(" ") === "sources list --json") return ok(args, "not json");
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const report = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", runner });
    expect(report.ready).toBe(false);
    expect(report.command_errors.some((error) => error.stage === "sources-list")).toBe(true);
  });

  it("validates explicit brain directories", () => {
    const brainDir = join(tmpdir(), `gbrain-dream-check-${Date.now()}`);
    mkdirSync(brainDir, { recursive: true });
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "");
      if (args.join(" ") === "sources list --json") return ok(args, JSON.stringify({ sources: [] }));
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const existing = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", brainDir, runner });
    expect(existing.brain_dir_exists).toBe(true);
    expect(existing.brain_dir_is_directory).toBe(true);

    rmSync(brainDir, { recursive: true, force: true });
    const missing = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", brainDir, runner });
    expect(missing.brain_dir_exists).toBe(false);
    expect(missing.brain_dir_ready).toBe(false);
  });

  it("does not treat a missing sync.repo_path as a usable brain directory", () => {
    const missingPath = join(tmpdir(), `missing-gbrain-sync-${Date.now()}`);
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "");
      if (args.join(" ") === "sources list --json") return ok(args, JSON.stringify({ sources: [] }));
      if (args[0] === "config" && args[1] === "get" && args[2] === "sync.repo_path") {
        return ok(args, `${missingPath}\n`);
      }
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const report = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", runner });
    expect(report.brain_dir_ready).toBe(false);
    expect(report.warnings).toContain(`Configured sync.repo_path is not usable: ${missingPath}`);
  });
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
bun test tests/gbrainDreamCheck.test.ts
```

Expected: FAIL because readiness module does not exist.

- [ ] **Step 3: Implement readiness check**

Create `src/gbrainDreamCheck.ts` with:

```ts
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createGbrainClient, runGbrain, type GbrainRunner } from "./gbrainClient.js";

export interface GbrainDreamCheckOptions {
  corpusDir?: string;
  brainDir?: string;
  runner?: GbrainRunner;
}

export interface GbrainDreamReadinessReport {
  ready: boolean;
  version: string | null;
  corpus_dir: string;
  brain_dir: string | null;
  brain_dir_ready: boolean;
  brain_dir_exists: boolean | null;
  brain_dir_is_directory: boolean | null;
  corpus_dir_exists: boolean;
  config: {
    embedding_model: string | null;
    embedding_dimensions: string | null;
    dream_synthesize_session_corpus_dir: string | null;
    dream_synthesize_enabled: string | null;
    models_dream_synthesize: string | null;
    models_dream_synthesize_verdict: string | null;
    models_tier_utility: string | null;
    models_tier_reasoning: string | null;
    models_tier_subagent: string | null;
    models_default: string | null;
    sync_repo_path: string | null;
  };
  missing_config: string[];
  mismatched_config: Array<{ key: string; expected: string; actual: string | null }>;
  warnings: string[];
  stale_sources: Array<{ id?: string; local_path?: string | null; federated?: boolean }>;
  command_errors: Array<{ stage: string; message: string }>;
  setup_commands: string[];
}

function parseConfigShowValue(output: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m");
  return pattern.exec(output)?.[1]?.trim() ?? null;
}

export function checkGbrainDreamReadiness(options: GbrainDreamCheckOptions = {}): GbrainDreamReadinessReport {
  const corpusDir = resolve(options.corpusDir ?? ".devbrain-teaching/dream-corpus/codex-sessions");
  const brainDir = options.brainDir ? resolve(options.brainDir) : null;
  const brainDirExists = brainDir ? existsSync(brainDir) : null;
  const brainDirIsDirectory = brainDir && brainDirExists ? statSync(brainDir).isDirectory() : brainDirExists === null ? null : false;
  const brainDirReady = (brainDir !== null && brainDirExists === true && brainDirIsDirectory === true);
  const nonThrowingRunner = options.runner ?? runGbrain;
  const client = createGbrainClient(options.runner);
  const missing_config: string[] = [];
  const mismatched_config: GbrainDreamReadinessReport["mismatched_config"] = [];
  const warnings: string[] = [];
  const command_errors: GbrainDreamReadinessReport["command_errors"] = [];

  function runRequired(stage: string, args: string[]): string | null {
    try {
      const result = options.runner ? options.runner(args) : client.run(args);
      if (result.exitCode !== 0) {
        command_errors.push({ stage, message: result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}` });
        return null;
      }
      return result.stdout.trim();
    } catch (error) {
      command_errors.push({ stage, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  function getConfig(key: string): string | null {
    try {
      const result = nonThrowingRunner(["config", "get", key]);
      if (result.exitCode !== 0) {
        const message = `${result.stderr}\n${result.stdout}`;
        if (/not found|missing|unset|unknown config/i.test(message)) return null;
        command_errors.push({ stage: `config-get:${key}`, message: result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}` });
        return null;
      }
      return result.stdout.trim() || null;
    } catch (error) {
      command_errors.push({ stage: `config-get:${key}`, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  const version = runRequired("version", ["--version"]);
  const configShow = runRequired("config-show", ["config", "show"]) ?? "";

  const synthDir = getConfig("dream.synthesize.session_corpus_dir");
  const enabled = getConfig("dream.synthesize.enabled");
  const config = {
    embedding_model: parseConfigShowValue(configShow, "embedding_model"),
    embedding_dimensions: parseConfigShowValue(configShow, "embedding_dimensions"),
    dream_synthesize_session_corpus_dir: synthDir,
    dream_synthesize_enabled: enabled,
    models_dream_synthesize: getConfig("models.dream.synthesize"),
    models_dream_synthesize_verdict: getConfig("models.dream.synthesize_verdict"),
    models_tier_utility: getConfig("models.tier.utility"),
    models_tier_reasoning: getConfig("models.tier.reasoning"),
    models_tier_subagent: getConfig("models.tier.subagent"),
    models_default: getConfig("models.default"),
    sync_repo_path: getConfig("sync.repo_path"),
  };

  if (!synthDir) missing_config.push("dream.synthesize.session_corpus_dir");
  if (synthDir && resolve(synthDir) !== corpusDir) {
    mismatched_config.push({ key: "dream.synthesize.session_corpus_dir", expected: corpusDir, actual: synthDir });
  }
  if (enabled !== "true") {
    if (!enabled) missing_config.push("dream.synthesize.enabled");
    else mismatched_config.push({ key: "dream.synthesize.enabled", expected: "true", actual: enabled });
  }
  if (!config.sync_repo_path) {
    warnings.push("sync.repo_path is not configured; pass --brain-dir to codex-dream-cycle or configure sync.repo_path before full dream runs.");
  }
  if (brainDir !== null && !brainDirReady) {
    warnings.push(`Explicit brain dir is not usable: ${brainDir}`);
  }
  if (!config.models_dream_synthesize && !config.models_tier_reasoning && !config.models_default) {
    warnings.push("No explicit strong synthesis model configured; gbrain will use its reasoning-tier fallback.");
  }
  if (!config.models_dream_synthesize_verdict && !config.models_tier_utility && !config.models_default) {
    warnings.push("No explicit verdict model configured; gbrain will use its utility-tier fallback.");
  }

  let stale_sources: GbrainDreamReadinessReport["stale_sources"] = [];
  const sourcesJson = runRequired("sources-list", ["sources", "list", "--json"]);
  if (sourcesJson) {
    try {
      const parsed = JSON.parse(sourcesJson) as { sources?: Array<{ id?: string; local_path?: string | null; federated?: boolean }> };
      stale_sources = (parsed.sources ?? []).filter((source) => source.id === "codex-sessions");
    } catch (error) {
      command_errors.push({ stage: "sources-list", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const setup_commands = [
    `gbrain config set dream.synthesize.session_corpus_dir ${JSON.stringify(corpusDir)}`,
    "gbrain config set dream.synthesize.enabled true",
  ];

  return {
    ready: existsSync(corpusDir) && (brainDir !== null ? brainDirReady : config.sync_repo_path !== null) && missing_config.length === 0 && mismatched_config.length === 0 && stale_sources.length === 0 && command_errors.length === 0,
    version,
    corpus_dir: corpusDir,
    brain_dir: brainDir,
    brain_dir_ready: brainDir !== null ? brainDirReady : config.sync_repo_path !== null,
    brain_dir_exists: brainDirExists,
    brain_dir_is_directory: brainDirIsDirectory,
    corpus_dir_exists: existsSync(corpusDir),
    config,
    missing_config,
    mismatched_config,
    warnings,
    stale_sources,
    command_errors,
    setup_commands,
  };
}
```

- [ ] **Step 4: Verify**

Run:

```bash
bun test tests/gbrainDreamCheck.test.ts
```

Expected: PASS.

---

## Task 5: Automation-Ready Dream Cycle Wrapper

**Files:**
- Create: `src/codexDreamCycle.ts`
- Create: `tests/codexDreamCycle.test.ts`

- [ ] **Step 1: Write failing cycle tests**

Create `tests/codexDreamCycle.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodexDreamCycle } from "../src/codexDreamCycle.js";
import type { GbrainRunner } from "../src/gbrainClient.js";

function brainDir(): string {
  return mkdtempSync(join(tmpdir(), "codex-dream-brain-"));
}

describe("codex dream cycle", () => {
  it("uses gbrain dry-run when requested", () => {
    const calls: string[][] = [];
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run`);
  });

  it("writes default cycle report files into the collector run directory", () => {
    const dir = brainDir();
    const runDir = mkdtempSync(join(tmpdir(), "codex-dream-cycle-run-"));
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => ({ corpusDir: "/corpus", runDir, considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
    });

    const jsonPath = join(runDir, "codex-dream-cycle.json");
    const markdownPath = join(runDir, "codex-dream-cycle.md");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toContain("not zero LLM cost");
  });

  it("does not block dry-run when readiness is incomplete", () => {
    const calls: string[][] = [];
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr: "missing" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run`);
  });

  it("writes a diagnostic report instead of invoking gbrain when no brain dir is available", () => {
    const calls: string[][] = [];
    let report: unknown;
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr: "missing" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: (value) => {
        report = value;
      },
    });

    expect(calls.map((args) => args.join(" "))).not.toContain("dream --dry-run");
    expect(JSON.stringify(report)).toContain("brain dir");
  });

  it("writes a failure report when gbrain dream fails", () => {
    let report: unknown;
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      if (args[0] === "dream") {
        return { command: ["gbrain", ...args], exitCode: 2, stdout: "partial output", stderr: "dream failed" };
      }
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() => runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: (value) => {
        report = value;
      },
    })).toThrow(/gbrain command failed/);

    expect(JSON.stringify(report)).toContain("dream failed");
    expect(JSON.stringify(report)).toContain("partial output");
    expect(JSON.stringify(report)).toContain("\"gbrain_exit_code\":2");
  });

  it("blocks full dream runs when readiness is incomplete", () => {
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr: "missing" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() => runCodexDreamCycle({
      dryRun: false,
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    })).toThrow(/not ready/);
  });
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
bun test tests/codexDreamCycle.test.ts
```

Expected: FAIL because cycle wrapper does not exist.

- [ ] **Step 3: Implement cycle wrapper**

Create `src/codexDreamCycle.ts` with:

```ts
import { collectCodexSessions, type CollectCodexSessionsResult } from "./codexCollector.js";
import { checkGbrainDreamReadiness } from "./gbrainDreamCheck.js";
import { createGbrainClient, GbrainCommandError, type GbrainRunner } from "./gbrainClient.js";

export interface CodexDreamCycleOptions {
  limit?: number;
  dryRun?: boolean;
  corpusDir?: string;
  brainDir?: string;
  runner?: GbrainRunner;
  collect?: () => CollectCodexSessionsResult;
  writeReport?: (report: unknown) => void;
}

export function runCodexDreamCycle(options: CodexDreamCycleOptions = {}): void {
  const collect = options.collect ?? (() => collectCodexSessions({ limit: options.limit, corpusDir: options.corpusDir }));
  const result = collect();
  const readiness = checkGbrainDreamReadiness({ corpusDir: result.corpusDir, brainDir: options.brainDir, runner: options.runner });
  if (!options.dryRun && !readiness.ready) {
    throw new Error(`gbrain dream is not ready: ${JSON.stringify(readiness, null, 2)}`);
  }
  if (!readiness.brain_dir_ready) {
    const report = {
      dry_run: options.dryRun === true,
      skipped_gbrain: true,
      skip_reason: "gbrain dream requires sync.repo_path or an explicit brain dir. Pass --brain-dir or set GBRAIN_DREAM_DIR.",
      collect: result,
      readiness,
      gbrain_args: null,
      gbrain_exit_code: null,
      stdout_preview: "",
      stderr_preview: "",
    };
    (options.writeReport ?? ((value) => writeDefaultCycleReport(result.runDir, value)))(report);
    return;
  }
  const client = createGbrainClient(options.runner);
  const baseArgs = options.brainDir ? ["dream", "--dir", options.brainDir] : ["dream"];
  const args = options.dryRun ? [...baseArgs, "--dry-run"] : baseArgs;
  const writeReport = options.writeReport ?? ((report) => writeDefaultCycleReport(result.runDir, report));
  try {
    const dreamResult = client.run(args);
    writeReport({
      dry_run: options.dryRun === true,
      dry_run_note: options.dryRun ? "gbrain dream --dry-run may still run the cheap verdict model; it is not zero LLM cost." : null,
      collect: result,
      readiness,
      gbrain_args: args,
      gbrain_exit_code: dreamResult.exitCode,
      stdout_preview: dreamResult.stdout.slice(0, 4000),
      stderr_preview: dreamResult.stderr.slice(0, 4000),
    });
  } catch (error) {
    const failureResult = error instanceof GbrainCommandError ? error.result : null;
    writeReport({
      dry_run: options.dryRun === true,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      collect: result,
      readiness,
      gbrain_args: args,
      gbrain_exit_code: failureResult?.exitCode ?? null,
      stdout_preview: (failureResult?.stdout ?? "").slice(0, 4000),
      stderr_preview: (failureResult?.stderr ?? "").slice(0, 4000),
    });
    throw error;
  }
}
```

- [ ] **Step 4: Write default cycle reports**

When `writeReport` is not injected, `runCodexDreamCycle` must call `writeDefaultCycleReport(result.runDir, report)` and write `codex-dream-cycle.json` and `codex-dream-cycle.md` into the collector `runDir` with owner-only file permissions:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function writeDefaultCycleReport(runDir: string, report: unknown): void {
  writeFileSync(join(runDir, "codex-dream-cycle.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(runDir, "codex-dream-cycle.md"), renderCycleMarkdown(report), { mode: 0o600 });
}
```

The Markdown report must include collection counts, readiness status, readiness warnings, gbrain args, exit code, stdout/stderr previews, and the dry-run cost note.

- [ ] **Step 5: Verify**

Run:

```bash
bun test tests/codexDreamCycle.test.ts
```

Expected: PASS.

---

## Task 6: CLI Wiring And Deprecated Direct Ingest Guard

**Files:**
- Modify: `src/index.ts`
- Modify: `src/cliArgs.ts`
- Modify: `package.json`
- Modify: `tests/cliArgs.test.ts`
- Delete: `src/codexGbrainIngest.ts`
- Delete: `tests/codexGbrainIngest.test.ts`

- [ ] **Step 1: Add scripts**

Modify `package.json` scripts:

```json
{
  "doctor": "bun run src/index.ts doctor",
  "candidates": "bun run src/index.ts candidates",
  "jina-proxy": "bun run src/index.ts jina-proxy",
  "jina-smoke": "bun run src/index.ts jina-smoke",
  "codex-collect": "bun run src/index.ts codex-collect",
  "gbrain-dream-check": "bun run src/index.ts gbrain-dream-check",
  "codex-dream-cycle": "bun run src/index.ts codex-dream-cycle",
  "codex-ingest": "bun run src/index.ts codex-ingest",
  "test": "bun test"
}
```

- [ ] **Step 2: Wire CLI commands**

In `src/index.ts`, import:

```ts
import { collectCodexSessions } from "./codexCollector.js";
import { runCodexDreamCycle } from "./codexDreamCycle.js";
import { checkGbrainDreamReadiness } from "./gbrainDreamCheck.js";
```

Add command behavior:

```ts
} else if (command === "codex-ingest") {
  console.error("codex-ingest is deprecated. Use codex-collect to prepare gbrain dream transcript corpus.");
  process.exitCode = 1;
} else if (command === "codex-collect") {
  const args = parseCodexCollectArgs(process.argv.slice(3));
  const result = collectCodexSessions({ limit: args.limit });
  console.log(`Codex sessions considered: ${result.considered}`);
  console.log(`Transcripts written: ${result.written}`);
  console.log(`Corpus: ${result.corpusDir}`);
  console.log(`Run artifacts: ${result.runDir}`);
} else if (command === "gbrain-dream-check") {
  const args = parseCodexCollectArgs(process.argv.slice(3));
  const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
  console.log(JSON.stringify(checkGbrainDreamReadiness({ brainDir }), null, 2));
} else if (command === "codex-dream-cycle") {
  const args = parseCodexCollectArgs(process.argv.slice(3));
  const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
  runCodexDreamCycle({ limit: args.limit, dryRun: args.dryRun, brainDir });
}
```

- [ ] **Step 3: Replace old CLI args parser**

Rename `parseCodexIngestArgs` to `parseCodexCollectArgs` and make it parse:

- `--limit <integer>` with range `1..100`, default `20`.
- `--dry-run` boolean for `codex-dream-cycle`.
- `--brain-dir <path>` optional path passed to `gbrain dream --dir`.

Update `tests/cliArgs.test.ts` so `--limit` without a value, `--limit 0`, negative numbers, non-numeric values, and values above 100 all fail.

- [ ] **Step 4: Delete invalid direct-source implementation and tests**

Delete `src/codexGbrainIngest.ts` and `tests/codexGbrainIngest.test.ts`. No test should assert that DevBrainTeaching can add a `codex-sessions` gbrain source, run `sync`, or run `embed`.

- [ ] **Step 5: Verify deprecated command**

Run:

```bash
bun run codex-ingest
```

Expected: non-zero exit and a deprecation message.

- [ ] **Step 6: Verify tests**

Run:

```bash
bun test
```

Expected: PASS.

---

## Task 7: Documentation And Migration Runbook

**Files:**
- Modify: `README.md`
- Modify: `docs/BOUNDARY.md`

- [ ] **Step 1: Update README**

Replace the Codex Session Ingestion section with:

````markdown
## Codex Session Corpus For GBrain Dream

DevBrainTeaching does not decide which lessons are durable. It prepares safe raw material for gbrain.

```bash
bun run codex-collect -- --limit 20
bun run gbrain-dream-check
GBRAIN_DREAM_DIR=/path/to/gbrain-brain-repo bun run codex-dream-cycle -- --limit 20 --dry-run
```

`codex-collect` writes compact `.txt` transcripts under `.devbrain-teaching/dream-corpus/codex-sessions/`.
`gbrain-dream-check` verifies that gbrain is configured to read that corpus.
`codex-dream-cycle -- --dry-run` is the safe diagnostic path when `GBRAIN_DREAM_DIR`, `--brain-dir`, or gbrain `sync.repo_path` identifies the brain repo, and may still spend cheap verdict-model tokens through gbrain. A scheduler should run `codex-dream-cycle -- --limit 20 --brain-dir /path/to/gbrain-brain-repo` only after readiness passes.

The old `codex-ingest` command is intentionally deprecated because it directly registered a gbrain source and embedded Codex sessions. That was the wrong boundary for a self-evolving gbrain mechanism.
````

- [ ] **Step 2: Update boundary doc**

Add to `docs/BOUNDARY.md`:

```markdown
## Codex Sessions

Codex App sessions are raw material. DevBrainTeaching may collect, redact, compact, and stage them as a transcript corpus. GBrain owns the decision about what becomes reflections, facts, patterns, takes, or searchable memory through dream/autopilot.

Do not make this repo generate final durable lessons from Codex sessions. That turns the adapter into the knowledge engine and bypasses gbrain.
```

- [ ] **Step 3: Verify docs and tests**

Run:

```bash
bun test
```

Expected: PASS.

---

## Task 8: Local Verification Without Real Mutation

**Files:**
- No source changes unless verification exposes a bug.

- [ ] **Step 1: Confirm old generated artifacts are absent**

Run:

```bash
find .devbrain-teaching -maxdepth 4 -type f -o -type d
```

Expected: no `gbrain-sources` or old run report files unless a fresh test intentionally created ignored output.

- [ ] **Step 2: Run full tests**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Run collector on a tiny slice**

Run:

```bash
bun run codex-collect -- --limit 2
```

Expected: writes two transcript corpus files and no gbrain source/sync/embed calls.

- [ ] **Step 4: Run readiness check**

Run:

```bash
bun run gbrain-dream-check
```

Expected: reports missing dream config and stale invalid `codex-sessions` source until the user explicitly approves cleanup/config mutation.

- [ ] **Step 5: Run dry-run cycle even before full readiness**

Run:

```bash
bun run codex-dream-cycle -- --limit 2 --dry-run
```

Expected: collection succeeds and the run report records readiness warnings. If neither `sync.repo_path` nor `--brain-dir` / `GBRAIN_DREAM_DIR` is available, the report explains that gbrain was not invoked. If a brain dir is available, `gbrain dream --dir <brain-dir> --dry-run` runs.

---

## Self-Review

- Spec coverage: the plan replaces direct source ingestion, keeps DevBrainTeaching as deterministic adapter, adds dream readiness checks, adds an automation-ready cycle command, and preserves gbrain as the durable knowledge runtime.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Boundary check: no plan step imports upstream gbrain TypeScript or writes gbrain DB directly.
- Mutation check: real gbrain cleanup/configuration is intentionally left as a separate explicit gate after `gbrain-dream-check`.
