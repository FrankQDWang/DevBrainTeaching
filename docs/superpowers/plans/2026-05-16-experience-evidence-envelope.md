# Experience Evidence Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Convert Codex-session corpus output into generic evidence envelopes that gbrain dream can evaluate without DevBrainTeaching making lesson judgments.

**Architecture:** Add a source-agnostic envelope module, map existing `ParsedCodexSession` into that schema using structural fields only, render envelope-first `.txt` corpus files, and record quality/debug totals in collector artifacts. The existing safe collector, v5 runtime wrappers, and gbrain dream boundary remain unchanged.

**Tech Stack:** Bun, TypeScript, Bun test, Node filesystem APIs, existing gbrain CLI wrappers.

**Spec:** [docs/superpowers/specs/2026-05-16-experience-evidence-envelope.md](../specs/2026-05-16-experience-evidence-envelope.md)

---

## File Structure

- Modify `src/redaction.ts`: add a reusable home/local-path redaction helper without hard-coded usernames.
- Modify `tests/redaction.test.ts`: cover dynamic home path redaction.
- Create `src/experienceEnvelope.ts`: source-agnostic schema, Codex structural adapter, quality calculations.
- Create `src/experienceEnvelopeWriter.ts`: envelope-first `.txt` renderer.
- Modify `src/codexDreamTranscriptWriter.ts`: delegate to the envelope renderer and bump `dreamRendererVersion`.
- Modify `src/codexCollector.ts`: include envelope quality in state/manifest/report and fingerprint.
- Create `tests/experienceEnvelope.test.ts`: schema, structural mapping, evidence ordering, and quality tests.
- Create `tests/experienceEnvelopeWriter.test.ts`: rendered corpus shape tests.
- Modify `tests/codexDreamTranscriptWriter.test.ts`: assert envelope-first transcript output.
- Modify `tests/codexCollector.test.ts`: assert manifest/report quality totals and unchanged rewrite behavior.
- Modify `README.md`: explain the envelope layer and v5 dry-run usage.

---

## Task 1: Add The Generic Envelope Schema

**Files:**
- Modify: `src/redaction.ts`
- Modify: `tests/redaction.test.ts`
- Create: `src/experienceEnvelope.ts`
- Create: `tests/experienceEnvelope.test.ts`

- [x] **Step 1: Extend shared redaction tests**

In `tests/redaction.test.ts`, add:

```ts
import { redactLocalPaths } from "../src/redaction.js";

it("redacts the current home path without hard-coded usernames", () => {
  const home = process.env.HOME ?? "/tmp/home";
  const result = redactLocalPaths(`open ${home}/Agents/DevBrainTeaching/src/index.ts`);

  expect(result.text).toBe("open $HOME/Agents/DevBrainTeaching/src/index.ts");
  expect(result.count).toBe(1);
  expect(result.text).not.toContain(home);
});
```

- [x] **Step 2: Implement shared local-path redaction**

In `src/redaction.ts`, add:

```ts
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactLocalPaths(value: string, home = process.env.HOME): RedactionResult {
  const redacted = redactText(value);
  if (!home) return redacted;
  const homePattern = new RegExp(escapeRegExp(home), "g");
  let count = redacted.count;
  const text = redacted.text.replace(homePattern, () => {
    count += 1;
    return "$HOME";
  });
  return { text, count };
}
```

- [x] **Step 3: Write failing envelope mapping tests**

Create `tests/experienceEnvelope.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import type { ParsedCodexSession } from "../src/codexSessionParser.js";
import { buildCodexExperienceEnvelope, experienceEnvelopeVersion } from "../src/experienceEnvelope.js";

const home = process.env.HOME ?? "/tmp/home";

function homePath(suffix: string): string {
  return `${home}${suffix}`;
}

function parsed(overrides: Partial<ParsedCodexSession> = {}): ParsedCodexSession {
  return {
    sourcePath: homePath("/.codex/sessions/s.jsonl"),
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 100,
    sessionId: "session-a",
    cwd: homePath("/Agents/DevBrainTeaching"),
    model: "gpt-5.5",
    originator: "Codex Desktop",
    startedAt: "2026-05-16T01:00:00.000Z",
    userGoals: ["Make the gbrain adapter reusable."],
    projectContext: [`CWD: ${homePath("/Agents/DevBrainTeaching")}`],
    keyEvents: ["Called exec_command: bun test"],
    assistantNotes: ["Decision: keep DevBrainTeaching deterministic because gbrain owns synthesis."],
    commands: ["bun test", "bun run gbrain-v5-dream-check"],
    commandResults: ["64 pass 0 fail", "ready true"],
    filePaths: [homePath("/Agents/DevBrainTeaching/src/index.ts")],
    outcomes: ["Added a v5 wrapper and verified it."],
    dropped: {
      malformedLines: 0,
      lowSignalEvents: 2,
      textFieldsTruncated: 1,
      secretsRedacted: 3,
    },
    ...overrides,
  };
}

describe("experience envelope", () => {
  it("maps Codex data through structural source channels only", () => {
    const { envelope } = buildCodexExperienceEnvelope(parsed());

    expect(envelope.envelope_version).toBe(experienceEnvelopeVersion);
    expect(envelope.source_kind).toBe("codex-session");
    expect(envelope.source_adapter).toBe("codex-session-adapter-v1");
    expect(envelope.source_id).toBe("session-a");
    expect(envelope.source_path_redacted).toBe("$HOME/.codex/sessions/s.jsonl");
    expect(envelope.workspace_redacted).toBe("$HOME/Agents/DevBrainTeaching");
    expect(envelope.goal).toEqual(["Make the gbrain adapter reusable."]);
    expect(envelope.evidence.some((item) => item.kind === "source_event" && item.source_channel === "keyEvents")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "tool_call" && item.source_channel === "commands")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "tool_result" && item.source_channel === "commandResults")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "assistant_commentary" && item.source_channel === "assistantNotes")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "assistant_final" && item.source_channel === "outcomes")).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain(home);
    expect(JSON.stringify(envelope)).not.toContain("likely_dream_reviewable");
    expect(JSON.stringify(envelope)).not.toContain("\"quality\"");
    expect(envelope.evidence.length).toBeLessThanOrEqual(30);
  });

  it("does not infer lessons, failures, fixes, decisions, or verification from keywords", () => {
    const { envelope } = buildCodexExperienceEnvelope(parsed({
      commandResults: ["error: test failed after fix"],
      assistantNotes: ["Decision: fixed because tests failed"],
    }));
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toContain("\"failure\"");
    expect(serialized).not.toContain("\"fix\"");
    expect(serialized).not.toContain("\"verification\"");
    expect(serialized).not.toContain("\"decision\"");
    expect(serialized).not.toContain("\"lesson\"");
  });

  it("preserves duplicate evidence as ordered source observations", () => {
    const { envelope } = buildCodexExperienceEnvelope(parsed({
      keyEvents: [],
      commands: ["bun test", "bun test"],
      commandResults: [],
    }));
    const toolCalls = envelope.evidence.filter((item) => item.kind === "tool_call");

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((item) => item.ordinal)).toEqual([1, 2]);
  });

  it("computes debug quality outside the corpus envelope", () => {
    const { envelope, quality } = buildCodexExperienceEnvelope(parsed({
      projectContext: [`CWD: ${homePath("/Agents/DevBrainTeaching")}`],
      userGoals: [],
      keyEvents: [],
      commands: [],
      commandResults: [],
      outcomes: [],
    }));

    expect("quality" in envelope).toBe(false);
    expect(quality.has_goal).toBe(false);
    expect(quality.has_source_event).toBe(false);
    expect(quality.has_tool_call).toBe(false);
    expect(quality.has_assistant_final).toBe(false);
    expect(quality.redacted_count).toBeGreaterThan(0);
    expect(quality.likely_dream_reviewable).toBe(false);
    expect(quality.notes).toContain("Missing goal evidence.");
  });
});
```

- [x] **Step 4: Run focused test to confirm failure**

Run:

```bash
bun test tests/redaction.test.ts tests/experienceEnvelope.test.ts
```

Expected: FAIL because `redactLocalPaths(...)` and `src/experienceEnvelope.ts` do not exist yet.

- [x] **Step 5: Implement the envelope module**

Create `src/experienceEnvelope.ts`:

```ts
import type { ParsedCodexSession } from "./codexSessionParser.js";
import { boundText, redactLocalPaths } from "./redaction.js";

export const experienceEnvelopeVersion = "experience-evidence-envelope-v1";
export const codexSessionAdapterVersion = "codex-session-adapter-v1";
const maxEvidenceItems = 30;
const maxEvidenceTextChars = 1_000;
const maxHeaderTextChars = 1_000;

export type ExperienceSourceKind = string;

export type ExperienceEvidenceKind =
  | "source_event"
  | "tool_call"
  | "tool_result"
  | "assistant_commentary"
  | "assistant_final"
  | "referenced_file";

export interface ExperienceEvidenceItem {
  kind: ExperienceEvidenceKind;
  source_channel: string;
  text: string;
  ordinal: number;
  provenance: {
    source_kind: ExperienceSourceKind;
    source_id: string;
    source_sha256: string;
  };
}

export interface ExperienceEnvelopeQuality {
  has_goal: boolean;
  has_source_event: boolean;
  has_tool_call: boolean;
  has_tool_result: boolean;
  has_assistant_final: boolean;
  evidence_count: number;
  redacted_count: number;
  truncated_count: number;
  malformed_count: number;
  low_signal_count: number;
  likely_dream_reviewable: boolean;
  notes: string[];
}

export interface ExperienceEvidenceEnvelope {
  schema_version: 1;
  envelope_version: typeof experienceEnvelopeVersion;
  source_kind: ExperienceSourceKind;
  source_adapter: string;
  source_id: string;
  source_sha256: string;
  source_path_redacted: string;
  workspace_redacted?: string;
  started_at?: string;
  model?: string;
  goal: string[];
  context: string[];
  evidence: ExperienceEvidenceItem[];
  trust_boundary: string[];
}

export interface ExperienceEnvelopeBuildResult {
  envelope: ExperienceEvidenceEnvelope;
  quality: ExperienceEnvelopeQuality;
}

interface NormalizedText {
  text: string;
  redacted: number;
  truncated: boolean;
}

function normalizeText(value: string): NormalizedText {
  const redacted = redactLocalPaths(value);
  const bounded = boundText(redacted.text.replace(/\n{3,}/g, "\n\n").trim(), maxEvidenceTextChars);
  return { text: bounded.text, redacted: redacted.count, truncated: bounded.truncated };
}

function normalizeHeaderText(value: string): NormalizedText {
  const redacted = redactLocalPaths(value);
  const bounded = boundText(redacted.text.replace(/\n{3,}/g, "\n\n").trim(), maxHeaderTextChars);
  return { text: bounded.text, redacted: redacted.count, truncated: bounded.truncated };
}

function applyStats(stats: AdapterStats, normalized: NormalizedText): string {
  stats.redacted += normalized.redacted;
  if (normalized.truncated) stats.truncated += 1;
  return normalized.text;
}

function makeItem(
  session: ParsedCodexSession,
  kind: ExperienceEvidenceKind,
  sourceChannel: string,
  text: string,
  ordinal: number,
): { item: ExperienceEvidenceItem; redacted: number; truncated: boolean } {
  const normalized = normalizeText(text);
  return {
    item: {
      kind,
      source_channel: sourceChannel,
      text: normalized.text,
      ordinal,
      provenance: {
        source_kind: "codex-session",
        source_id: session.sessionId,
        source_sha256: session.sourceSha256,
      },
    },
    redacted: normalized.redacted,
    truncated: normalized.truncated,
  };
}

interface AdapterStats {
  redacted: number;
  truncated: number;
  omitted: number;
}

function pushItem(items: ExperienceEvidenceItem[], stats: AdapterStats, built: { item: ExperienceEvidenceItem; redacted: number; truncated: boolean }): void {
  if (!built.item.text) return;
  stats.redacted += built.redacted;
  if (built.truncated) stats.truncated += 1;
  if (items.length >= maxEvidenceItems) return;
  items.push(built.item);
}

function pushMany(
  session: ParsedCodexSession,
  items: ExperienceEvidenceItem[],
  stats: AdapterStats,
  kind: ExperienceEvidenceKind,
  sourceChannel: string,
  values: string[],
): void {
  for (const value of values) {
    if (items.length >= maxEvidenceItems) {
      stats.omitted += 1;
      continue;
    }
    pushItem(items, stats, makeItem(session, kind, sourceChannel, value, items.length + 1));
  }
}

function quality(session: ParsedCodexSession, evidence: ExperienceEvidenceItem[], stats: AdapterStats): ExperienceEnvelopeQuality {
  const has = (kind: ExperienceEvidenceKind): boolean => evidence.some((item) => item.kind === kind);
  const result: ExperienceEnvelopeQuality = {
    has_goal: session.userGoals.length > 0,
    has_source_event: has("source_event"),
    has_tool_call: has("tool_call"),
    has_tool_result: has("tool_result"),
    has_assistant_final: has("assistant_final"),
    evidence_count: evidence.length,
    redacted_count: session.dropped.secretsRedacted + stats.redacted,
    truncated_count: session.dropped.textFieldsTruncated + stats.truncated,
    malformed_count: session.dropped.malformedLines,
    low_signal_count: session.dropped.lowSignalEvents,
    likely_dream_reviewable: false,
    notes: [],
  };

  if (!result.has_goal) result.notes.push("Missing goal evidence.");
  if (!result.has_source_event && !result.has_tool_call) result.notes.push("Missing observed action evidence.");
  if (!result.has_tool_result) result.notes.push("Missing observed result evidence.");
  if (!result.has_assistant_final) result.notes.push("Missing assistant final output.");
  if (stats.omitted > 0) result.notes.push(`Omitted ${stats.omitted} evidence items after item-count bound.`);
  result.likely_dream_reviewable = result.has_goal && (result.has_source_event || result.has_tool_call) && (result.has_tool_result || result.has_assistant_final);
  if (result.likely_dream_reviewable) result.notes.push("Has enough observed structure for gbrain dream review.");
  return result;
}

export function buildCodexExperienceEnvelope(session: ParsedCodexSession): ExperienceEnvelopeBuildResult {
  const evidence: ExperienceEvidenceItem[] = [];
  const stats: AdapterStats = { redacted: 0, truncated: 0, omitted: 0 };

  pushMany(session, evidence, stats, "source_event", "keyEvents", session.keyEvents);
  pushMany(session, evidence, stats, "tool_call", "commands", session.commands);
  pushMany(session, evidence, stats, "tool_result", "commandResults", session.commandResults);
  pushMany(session, evidence, stats, "assistant_commentary", "assistantNotes", session.assistantNotes);
  pushMany(session, evidence, stats, "assistant_final", "outcomes", session.outcomes);
  pushMany(session, evidence, stats, "referenced_file", "filePaths", session.filePaths);

  const sourcePath = applyStats(stats, normalizeHeaderText(session.sourcePath));
  const workspace = session.cwd ? applyStats(stats, normalizeHeaderText(session.cwd)) : undefined;
  const goal = session.userGoals.map((value) => applyStats(stats, normalizeHeaderText(value))).filter(Boolean);
  const context = session.projectContext.map((value) => applyStats(stats, normalizeHeaderText(value))).filter(Boolean);
  const envelope: ExperienceEvidenceEnvelope = {
    schema_version: 1,
    envelope_version: experienceEnvelopeVersion,
    source_kind: "codex-session",
    source_adapter: codexSessionAdapterVersion,
    source_id: session.sessionId,
    source_sha256: session.sourceSha256,
    source_path_redacted: sourcePath,
    workspace_redacted: workspace,
    started_at: session.startedAt,
    model: session.model,
    goal,
    context,
    evidence,
    trust_boundary: [
      "This is raw evidence, not durable knowledge.",
      "GBrain decides what, if anything, should be synthesized.",
      "This envelope may contain failed attempts, stale assumptions, and partial command output.",
    ],
  };
  return { envelope, quality: quality(session, evidence, stats) };
}
```

- [x] **Step 6: Verify the envelope module**

Run:

```bash
bun test tests/redaction.test.ts tests/experienceEnvelope.test.ts
```

Expected: PASS.

---

## Task 2: Render Envelope-First Dream Corpus

**Files:**
- Create: `src/experienceEnvelopeWriter.ts`
- Create: `tests/experienceEnvelopeWriter.test.ts`
- Modify: `src/codexDreamTranscriptWriter.ts`
- Modify: `tests/codexDreamTranscriptWriter.test.ts`

- [x] **Step 1: Write failing renderer tests**

Create `tests/experienceEnvelopeWriter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

import { renderExperienceEnvelope } from "../src/experienceEnvelopeWriter.js";
import type { ExperienceEvidenceEnvelope } from "../src/experienceEnvelope.js";

function envelope(): ExperienceEvidenceEnvelope {
  return {
    schema_version: 1,
    envelope_version: "experience-evidence-envelope-v1",
    source_kind: "codex-session",
    source_adapter: "codex-session-adapter-v1",
    source_id: "session-a",
    source_sha256: "a".repeat(64),
    source_path_redacted: "$HOME/.codex/sessions/s.jsonl",
    workspace_redacted: "$HOME/Agents/DevBrainTeaching",
    started_at: "2026-05-16T01:00:00.000Z",
    model: "gpt-5.5",
    goal: ["Make evidence generic."],
    context: ["CWD: $HOME/Agents/DevBrainTeaching"],
    evidence: [
      { kind: "source_event", source_channel: "keyEvents", text: "Called exec_command: bun test", ordinal: 1, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
      { kind: "tool_call", source_channel: "commands", text: "bun test", ordinal: 2, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
      { kind: "tool_result", source_channel: "commandResults", text: "64 pass 0 fail", ordinal: 3, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
      { kind: "assistant_final", source_channel: "outcomes", text: "Dry-run completed.", ordinal: 4, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
    ],
    trust_boundary: ["This is raw evidence, not durable knowledge."],
  };
}

describe("experience envelope writer", () => {
  it("renders envelope-first text for gbrain dream without debug readiness hints", () => {
    const text = renderExperienceEnvelope(envelope());

    expect(text).toContain("type: experience-evidence-envelope");
    expect(text).toContain("# Experience Evidence Envelope");
    expect(text).toContain("## Observed Evidence");
    expect(text).toContain("### Source Events");
    expect(text).toContain("[keyEvents] Called exec_command: bun test");
    expect(text).toContain("### Tool Calls");
    expect(text).toContain("[commands] bun test");
    expect(text).toContain("### Tool Results");
    expect(text).toContain("[commandResults] 64 pass 0 fail");
    expect(text).toContain("### Assistant Final Output");
    expect(text).toContain("[outcomes] Dry-run completed.");
    expect(text).toContain("This is raw evidence, not durable knowledge.");
    expect(text).not.toContain("Likely dream");
    expect(text).not.toContain("likely_dream");
    expect(text).not.toContain("Malformed lines");
    expect(text).not.toContain("Secrets redacted");
  });
});
```

- [x] **Step 2: Run focused test to confirm failure**

Run:

```bash
bun test tests/experienceEnvelopeWriter.test.ts
```

Expected: FAIL because `src/experienceEnvelopeWriter.ts` does not exist.

- [x] **Step 3: Implement envelope renderer**

Create `src/experienceEnvelopeWriter.ts`:

```ts
import type { ExperienceEvidenceEnvelope, ExperienceEvidenceKind } from "./experienceEnvelope.js";

const maxEnvelopeChars = 50_000;

function yaml(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

function list(values: string[], fallback = "Not captured."): string {
  if (values.length === 0) return `- ${fallback}`;
  return values.map((value) => `- ${value.replace(/\n/g, "\n  ")}`).join("\n");
}

function evidenceList(envelope: ExperienceEvidenceEnvelope, kind: ExperienceEvidenceKind): string {
  return list(
    envelope.evidence
      .filter((item) => item.kind === kind)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((item) => `[${item.source_channel}] ${item.text}`),
  );
}

function ensureCap(value: string): string {
  if (value.length > maxEnvelopeChars) {
    throw new Error(`Rendered envelope exceeds ${maxEnvelopeChars} chars; item-level bounds should prevent this.`);
  }
  return value;
}

export function renderExperienceEnvelope(envelope: ExperienceEvidenceEnvelope): string {
  return ensureCap(`---
type: experience-evidence-envelope
schema_version: ${envelope.schema_version}
envelope_version: ${yaml(envelope.envelope_version)}
source_kind: ${yaml(envelope.source_kind)}
source_adapter: ${yaml(envelope.source_adapter)}
source_id: ${yaml(envelope.source_id)}
source_sha256: ${yaml(envelope.source_sha256)}
started_at: ${yaml(envelope.started_at)}
dream_generated: false
tags: ["experience-evidence", "raw-material"]
---
# Experience Evidence Envelope

## Goal
${list(envelope.goal)}

## Context
${list(envelope.context)}

## Observed Evidence
### Source Events
${evidenceList(envelope, "source_event")}

### Tool Calls
${evidenceList(envelope, "tool_call")}

### Tool Results
${evidenceList(envelope, "tool_result")}

### Assistant Commentary
${evidenceList(envelope, "assistant_commentary")}

### Assistant Final Output
${evidenceList(envelope, "assistant_final")}

### Referenced Files
${evidenceList(envelope, "referenced_file")}

## Trust Boundary
${list(envelope.trust_boundary)}

## Source Appendix
- Source kind: ${envelope.source_kind}
- Source adapter: ${envelope.source_adapter}
- Source ID: ${envelope.source_id}
- Source path: ${envelope.source_path_redacted}
- Workspace: ${envelope.workspace_redacted ?? "Not captured."}
- Model: ${envelope.model ?? "Not captured."}
`);
}
```

- [x] **Step 4: Delegate dream transcript rendering to envelopes**

Modify `src/codexDreamTranscriptWriter.ts`:

```ts
import type { ParsedCodexSession } from "./codexSessionParser.js";
import { buildCodexExperienceEnvelope } from "./experienceEnvelope.js";
import { renderExperienceEnvelope } from "./experienceEnvelopeWriter.js";
import { safeSlug } from "./codexTranscriptWriter.js";

export const dreamRendererVersion = "codex-dream-transcript-renderer-v2";

function datePrefix(session: ParsedCodexSession): string {
  const parsed = session.startedAt ? Date.parse(session.startedAt) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "unknown-date";
}

export function dreamTranscriptFilename(session: ParsedCodexSession): string {
  return `${datePrefix(session)}-${safeSlug(session.sessionId)}-${session.sourceSha256.slice(0, 8)}.txt`;
}

export function renderDreamTranscript(session: ParsedCodexSession): string {
  return renderExperienceEnvelope(buildCodexExperienceEnvelope(session).envelope);
}
```

- [x] **Step 5: Update existing writer tests**

In `tests/codexDreamTranscriptWriter.test.ts`, change assertions so the rendered text contains:

```ts
expect(markdown).toContain("type: experience-evidence-envelope");
expect(markdown).toContain("# Experience Evidence Envelope");
expect(markdown).toContain("## Observed Evidence");
expect(markdown).toContain("This is raw evidence");
expect(markdown).not.toContain("type: codex-session-transcript");
expect(markdown).not.toContain("Likely dream");
```

- [x] **Step 6: Verify renderers**

Run:

```bash
bun test tests/experienceEnvelope.test.ts tests/experienceEnvelopeWriter.test.ts tests/codexDreamTranscriptWriter.test.ts
```

Expected: PASS.

---

## Task 3: Add Envelope Quality To Collector Artifacts

**Files:**
- Modify: `src/codexCollector.ts`
- Modify: `tests/codexCollector.test.ts`

- [x] **Step 1: Write failing collector quality assertions**

Add a richer fixture helper to `tests/codexCollector.test.ts`:

```ts
function writeRichSession(path: string, id: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      JSON.stringify({ timestamp: "2026-05-14T01:00:00.000Z", payload: { type: "session_meta", id, cwd: "/repo" } }),
      JSON.stringify({ timestamp: "2026-05-14T01:01:00.000Z", payload: { type: "message", role: "user", content: [{ text: "Build gbrain adapter." }] } }),
      JSON.stringify({ timestamp: "2026-05-14T01:02:00.000Z", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "bun test" }) } }),
      JSON.stringify({ timestamp: "2026-05-14T01:03:00.000Z", payload: { type: "function_call_output", output: "64 pass 0 fail" } }),
      JSON.stringify({ timestamp: "2026-05-14T01:04:00.000Z", payload: { type: "message", role: "assistant", phase: "final", content: [{ text: "Implemented and verified." }] } }),
    ].join("\n"),
  );
}
```

In the first collector test, call `writeRichSession(...)` instead of `writeSession(...)`.

After reading `state`, add:

```ts
expect(state.envelope_version).toBe("experience-evidence-envelope-v1");
expect(state.counters.envelope_likely_dream_reviewable).toBe(1);
expect(state.counters.envelope_evidence_items).toBeGreaterThan(0);
expect(state.counters.envelope_redacted_count).toBeGreaterThanOrEqual(0);
expect(state.counters.envelope_truncated_count).toBeGreaterThanOrEqual(0);
expect(state.counters.envelope_malformed_count).toBeGreaterThanOrEqual(0);
expect(state.counters.envelope_low_signal_count).toBeGreaterThanOrEqual(0);
```

After reading the manifest, assert per-session quality:

```ts
const manifest = JSON.parse(readFileSync(join(result.runDir, "manifest.json"), "utf8"));
expect(manifest.sessions[0].envelope_quality).toMatchObject({
  has_goal: true,
  has_tool_call: true,
  has_tool_result: true,
  has_assistant_final: true,
  redacted_count: expect.any(Number),
  truncated_count: expect.any(Number),
  malformed_count: expect.any(Number),
  low_signal_count: expect.any(Number),
  likely_dream_reviewable: true,
});
const report = readFileSync(join(result.runDir, "report.md"), "utf8");
expect(report).toContain("Envelope likely dream-reviewable: 1");
expect(report).toContain("Envelope redacted count:");
expect(report).toContain("Envelope truncated count:");
expect(report).toContain("Envelope malformed count:");
expect(report).toContain("Envelope low-signal count:");
```

Add a dedicated negative test named `marks goal-only minimal sessions as not dream-reviewable`. It should use the existing minimal `writeSession(...)` fixture, run `collectCodexSessions(...)`, read that run's `manifest.json`, and assert:

```ts
const manifest = JSON.parse(readFileSync(join(result.runDir, "manifest.json"), "utf8"));
expect(manifest.sessions[0].envelope_quality.likely_dream_reviewable).toBe(false);
```

- [x] **Step 2: Run focused test to confirm failure**

Run:

```bash
bun test tests/codexCollector.test.ts
```

Expected: FAIL because the collector does not expose envelope quality counters yet.

- [x] **Step 3: Extend collector state and counters**

Modify `src/codexCollector.ts` imports:

```ts
import {
  buildCodexExperienceEnvelope,
  codexSessionAdapterVersion,
  experienceEnvelopeVersion,
  type ExperienceEvidenceEnvelope,
  type ExperienceEnvelopeQuality,
} from "./experienceEnvelope.js";
```

Add `envelope_version` to `CollectorState`:

```ts
envelope_version: string;
```

Add these counters:

```ts
envelope_evidence_items: number;
envelope_with_goal: number;
envelope_with_source_event: number;
envelope_with_tool_call: number;
envelope_with_tool_result: number;
envelope_with_assistant_final: number;
envelope_likely_dream_reviewable: number;
envelope_redacted_count: number;
envelope_truncated_count: number;
envelope_malformed_count: number;
envelope_low_signal_count: number;
```

Update `fingerprint(session)` to include the envelope version:

```ts
function fingerprint(session: ParsedCodexSession): string {
  return [
    session.sourceSha256,
    codexSessionParserVersion,
    dreamRendererVersion,
    redactionVersion,
    codexSessionAdapterVersion,
    experienceEnvelopeVersion,
  ].join(":");
}
```

- [x] **Step 4: Accumulate envelope quality**

Change `parsedSessions` into a record array so the parsed session, envelope, and quality stay attached through write, state, and manifest generation:

```ts
const parsedRecords: Array<{
  session: ParsedCodexSession;
  envelope: ExperienceEvidenceEnvelope;
  quality: ExperienceEnvelopeQuality;
}> = [];
```

Inside the parse loop in `collectCodexSessions`, after `const session = parseCodexSessionJsonl(...)`, build the envelope result once and push a record:

```ts
const envelopeResult = buildCodexExperienceEnvelope(session);
const envelopeQuality = envelopeResult.quality;
parsedRecords.push({ session, envelope: envelopeResult.envelope, quality: envelopeQuality });
counters.envelope_evidence_items += envelopeQuality.evidence_count;
if (envelopeQuality.has_goal) counters.envelope_with_goal += 1;
if (envelopeQuality.has_source_event) counters.envelope_with_source_event += 1;
if (envelopeQuality.has_tool_call) counters.envelope_with_tool_call += 1;
if (envelopeQuality.has_tool_result) counters.envelope_with_tool_result += 1;
if (envelopeQuality.has_assistant_final) counters.envelope_with_assistant_final += 1;
if (envelopeQuality.likely_dream_reviewable) counters.envelope_likely_dream_reviewable += 1;
counters.envelope_redacted_count += envelopeQuality.redacted_count;
counters.envelope_truncated_count += envelopeQuality.truncated_count;
counters.envelope_malformed_count += envelopeQuality.malformed_count;
counters.envelope_low_signal_count += envelopeQuality.low_signal_count;
```

Replace later `parsedSessions.map(...)` usage with `parsedRecords.map(({ session, quality }) => ...)`.

When building each `manifest.sessions` item, include:

```ts
envelope_quality: quality,
```

Set state:

```ts
envelope_version: experienceEnvelopeVersion,
```

Update `renderReport` to include:

```ts
`- Envelope evidence items: ${state.counters.envelope_evidence_items}`,
`- Envelope sessions with goal: ${state.counters.envelope_with_goal}`,
`- Envelope sessions with source event: ${state.counters.envelope_with_source_event}`,
`- Envelope sessions with tool call: ${state.counters.envelope_with_tool_call}`,
`- Envelope sessions with tool result: ${state.counters.envelope_with_tool_result}`,
`- Envelope sessions with assistant final: ${state.counters.envelope_with_assistant_final}`,
`- Envelope likely dream-reviewable: ${state.counters.envelope_likely_dream_reviewable}`,
`- Envelope redacted count: ${state.counters.envelope_redacted_count}`,
`- Envelope truncated count: ${state.counters.envelope_truncated_count}`,
`- Envelope malformed count: ${state.counters.envelope_malformed_count}`,
`- Envelope low-signal count: ${state.counters.envelope_low_signal_count}`,
```

- [x] **Step 5: Verify collector behavior**

Run:

```bash
bun test tests/codexCollector.test.ts
```

Expected: PASS.

---

## Task 4: Update README And Run Real Dry-Run

**Files:**
- Modify: `README.md`

- [x] **Step 1: Update README with the envelope layer**

In `README.md`, under `Codex Session Corpus For GBrain Dream`, add:

```markdown
The corpus is envelope-first. `codex-collect` turns each raw Codex session into
an Experience Evidence Envelope: goal, context, observed source events, tool
calls, tool results, assistant commentary, assistant final output, referenced
files, trust boundary, and provenance. This is still raw material.
DevBrainTeaching does not decide that an item is a lesson; gbrain dream/verdict
decides what, if anything, becomes durable knowledge.
```

Under `Repo-Local GBrain V5 Runtime`, keep the v5 commands as the recommended path:

```markdown
bun run gbrain-v5-dream-check
bun run codex-v5-dream-cycle -- --limit 20 --dry-run
```

- [x] **Step 2: Run full tests**

Run:

```bash
bun test
```

Expected: PASS.

- [x] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [x] **Step 4: Run a small collection smoke test**

Run:

```bash
bun run codex-collect -- --limit 2
```

Expected output includes:

```text
Codex sessions considered: 2
Corpus: /Users/frankqdwang/Agents/DevBrainTeaching/.devbrain-teaching/dream-corpus/codex-sessions
```

Open the newest generated report:

```bash
find .devbrain-teaching/runs -type f -name report.md | sort | tail -1 | xargs sed -n '1,120p'
```

Expected: the report includes `Envelope evidence items` and `Envelope likely dream-reviewable`.

- [x] **Step 5: Run v5 dream dry-run**

Run:

```bash
bun run gbrain-v5-dream-check
bun run codex-v5-dream-cycle -- --limit 20 --dry-run
```

Expected:

- readiness is `true`;
- report records `embedding_model: litellm:jina-embeddings-v5-text-small`;
- report records `embedding_dimensions: 1024`;
- `gbrain_exit_code` is `0`;
- `stdout_preview` includes gbrain's synthesize dry-run summary.

- [x] **Step 6: Commit**

```bash
git add README.md TODOS.md docs/superpowers/specs/2026-05-16-experience-evidence-envelope.md docs/superpowers/plans/2026-05-16-experience-evidence-envelope.md src/redaction.ts src/experienceEnvelope.ts src/experienceEnvelopeWriter.ts src/codexDreamTranscriptWriter.ts src/codexCollector.ts tests/redaction.test.ts tests/experienceEnvelope.test.ts tests/experienceEnvelopeWriter.test.ts tests/codexDreamTranscriptWriter.test.ts tests/codexCollector.test.ts
git commit -m "feat: add experience evidence envelopes"
```

---

## Self-Review

- Spec coverage: Tasks cover source-agnostic schema, structural Codex mapping, envelope-first rendering, collector quality artifacts, README updates, and real v5 dry-run validation.
- Placeholder scan: No forbidden placeholder patterns are present.
- Type consistency: `experienceEnvelopeVersion`, `buildCodexExperienceEnvelope`, and `renderExperienceEnvelope` are introduced before they are used by writer and collector tasks.
