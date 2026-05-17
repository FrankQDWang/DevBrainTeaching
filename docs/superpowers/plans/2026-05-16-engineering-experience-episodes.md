# Engineering Experience Episodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Codex App sessions into deterministic, source-backed engineering experience episodes that gbrain dream can evaluate, without DevBrainTeaching deciding durable lessons.

**Architecture:** Extend the existing Codex parser where real session JSONL is under-captured, add an engineering episode adapter and renderer beside the existing generic evidence envelope, write `.engineering.txt` files to an engineering-only gbrain corpus, keep raw envelopes as debug artifacts outside that corpus, and improve dream-cycle diagnostics so humans can distinguish weak collector material from conservative gbrain verdicts.

**Tech Stack:** Bun, TypeScript, Bun test, Node filesystem APIs, existing gbrain CLI wrappers.

**Spec:** [docs/superpowers/specs/2026-05-16-engineering-experience-episodes.md](../specs/2026-05-16-engineering-experience-episodes.md)

---

## File Structure

- Modify `src/codexSessionParser.ts`: improve extraction of real Codex tool-output and final-output JSONL shapes.
- Modify `src/redaction.ts`: add counted redaction-and-bound helper for engineering text.
- Modify `tests/codexSessionParser.test.ts`: add realistic `response_item` / `event_msg` parser fixtures.
- Modify `tests/redaction.test.ts`: cover counted engineering redaction and truncation.
- Create `src/engineeringExperienceEpisode.ts`: source-backed engineering episode schema, Codex adapter, and quality calculation.
- Create `src/engineeringExperienceEpisodeWriter.ts`: `.engineering.txt` renderer.
- Modify `src/codexCollector.ts`: split engineering corpus from raw envelope debug output, write engineering episode files, include quality totals in state/manifest/report, and track raw/engineering fingerprints independently.
- Modify `src/gbrainDreamCheck.ts`: make the default dream corpus path the engineering corpus directory.
- Modify `src/codexDreamCycle.ts`: capture dry-run diagnostics and classify collector quality vs conservative gbrain verdict in reports.
- Modify `tests/codexCollector.test.ts`: verify engineering files, manifest/report totals, no gbrain calls, and unchanged no-rewrite behavior.
- Create `tests/engineeringExperienceEpisode.test.ts`: adapter and quality tests.
- Create `tests/engineeringExperienceEpisodeWriter.test.ts`: corpus shape and forbidden-debug-string tests.
- Modify `tests/codexDreamCycle.test.ts`: verify dry-run diagnostic reporting.
- Modify `tests/index.test.ts` or CLI tests if present: verify both `codex-dream-cycle` and `codex-v5-dream-cycle` use the same diagnostic path.
- Modify `README.md`: document the engineering episode layer and the non-invasive gbrain boundary.

---

## Task 1: Add Parser Fixtures For Real Codex Tool Results

**Files:**
- Modify: `tests/codexSessionParser.test.ts`
- Modify: `src/codexSessionParser.ts`

- [ ] **Step 1: Add failing parser coverage for `response_item` tool output**

In `tests/codexSessionParser.test.ts`, add a test that writes a JSONL fixture with a current Codex-style tool call and output. Keep the fixture inline with `writeFileSync` like the existing parser tests.

Use one fixture with the simple `cmd` shape and one fixture copied from the shape of a real local Codex session, reduced to non-sensitive fields.

Simple shape:

```ts
writeFileSync(
  sessionPath,
  [
    JSON.stringify({
      timestamp: "2026-05-16T01:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call-1",
        arguments: JSON.stringify({ cmd: "bun test" }),
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-16T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: "64 pass\\n0 fail\\n",
      },
    }),
  ].join("\\n") + "\\n",
);
```

Assert:

```ts
expect(session.commands).toContain("bun test");
expect(session.commandResults.join("\\n")).toContain("64 pass");
```

Realistic command-array and JSON-wrapped output shape:

```ts
writeFileSync(
  sessionPath,
  [
    JSON.stringify({
      timestamp: "2026-05-16T01:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        call_id: "call-1",
        arguments: JSON.stringify({
          command: ["bash", "-lc", "printf '64 pass\\n0 fail\\n'"],
          workdir: "/repo",
        }),
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-16T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
        output: JSON.stringify({
          output: "64 pass\\n0 fail\\n",
          metadata: { exit_code: 0, duration_seconds: 0.1 },
        }),
      },
    }),
  ].join("\\n") + "\\n",
);
```

Assert:

```ts
expect(session.commands.join("\\n")).toContain("bash -lc");
expect(session.commandResults.join("\\n")).toContain("64 pass");
expect(session.commandResults.join("\\n")).toContain("exit_code");
```

- [ ] **Step 2: Add failing parser coverage for `event_msg` user/final output**

Add a second fixture with:

- `type = "event_msg"` and `payload.type = "user_message"` for user goals;
- `type = "response_item"` and assistant final message content for outcomes.

Assert:

```ts
expect(session.userGoals.join("\\n")).toContain("engineering experience");
expect(session.outcomes.join("\\n")).toContain("implemented");
```

The final outcome fixture must use a structural marker such as `payload.phase = "final"` or `payload.channel = "final"`. Add a negative assertion that assistant text containing words such as `implemented`, `fixed`, or `done` without a final marker is parsed as an assistant observation, not a final outcome.

- [ ] **Step 3: Add failing parser coverage for event stream and negative cases**

Add tests that assert:

- parsed output exposes a source-order evidence event stream;
- command and result events preserve matching `call_id`;
- `ordinal` increases in source order;
- `tool_name`, `timestamp`, and `raw_payload_type` are preserved when present;
- encrypted/private reasoning entries are dropped;
- malformed JSONL increments `malformedLines`;
- huge output is bounded and increments truncation count;
- `payload.content` string, array, and object forms are handled conservatively;
- `payload.stdout`, `payload.stderr`, and `payload.content` are used when `payload.output` is absent.

- [ ] **Step 4: Run the focused failing test**

Run:

```bash
bun test tests/codexSessionParser.test.ts
```

Expected: at least one new assertion fails if the current parser misses a real tool-output or final-output shape.

- [ ] **Step 5: Harden extraction without executing JSONL content**

In `src/codexSessionParser.ts`, update extraction helpers so parser coverage includes:

- `record.type = "response_item"` with `payload.type = "function_call"`;
- `record.type = "response_item"` with `payload.type = "function_call_output"`;
- `record.type = "event_msg"` with `payload.type = "user_message"`;
- assistant `payload.type = "message"` with `role = "assistant"` and phase/final markers when present;
- command text from `arguments.cmd`, `arguments.command` string, or `arguments.command` string array;
- output text found under `payload.output`, `payload.content`, `payload.stdout`, `payload.stderr`, or nested string content arrays;
- JSON-wrapped output where `payload.output` parses to an object with `output`, `stdout`, `stderr`, or `metadata.exit_code`.
- event stream entries with `ordinal`, `timestamp`, `source_channel`, `kind`, `text`, `call_id`, `tool_name`, and `raw_payload_type`.

Keep these rules:

- do not execute parsed arguments;
- parse command arguments with `JSON.parse` only when the field is a string;
- bound extracted output using existing text caps;
- increment drop/truncation counters through existing parser mechanisms.
- extract file paths with a dynamic home/local-path pattern instead of a hard-coded `/Users/frankqdwang` regex.
- classify final outcomes only through structural final markers: `payload.phase === "final"`, `payload.phase === "final_answer"`, `payload.channel === "final"`, or explicit completed/final metadata. Do not use keywords.

Add a compatible event-stream field without removing existing arrays:

```ts
export interface ParsedCodexEvidenceEvent {
  ordinal: number;
  timestamp?: string;
  source_channel: string;
  kind:
    | "goal"
    | "context"
    | "source_event"
    | "engineering_action"
    | "observed_result"
    | "assistant_observation"
    | "final_outcome"
    | "referenced_file";
  text: string;
  call_id?: string;
  tool_name?: string;
  raw_payload_type?: string;
}

export interface ParsedCodexSession {
  // existing fields...
  engineeringEvents: ParsedCodexEvidenceEvent[];
}
```

- [ ] **Step 6: Re-run focused parser tests**

Run:

```bash
bun test tests/codexSessionParser.test.ts
```

Expected: PASS.

---

## Task 2: Add Engineering Episode Adapter

**Files:**
- Modify: `src/redaction.ts`
- Modify: `tests/redaction.test.ts`
- Create: `src/engineeringExperienceEpisode.ts`
- Create: `tests/engineeringExperienceEpisode.test.ts`

- [ ] **Step 1: Write failing counted redaction tests**

In `tests/redaction.test.ts`, add coverage for:

```ts
const result = redactAndBoundEngineeringText(`${process.env.HOME}/repo OPENAI_API_KEY=sk-${"a".repeat(40)} ${"x".repeat(2000)}`, 200);

expect(result.text).toContain("$HOME/repo");
expect(result.text).toContain("[REDACTED_SECRET]");
expect(result.text).toContain("[TRUNCATED]");
expect(result.redacted_count).toBeGreaterThanOrEqual(2);
expect(result.truncated_count).toBe(1);
```

- [ ] **Step 2: Implement counted redaction helper**

In `src/redaction.ts`, add:

```ts
export interface RedactedBoundText {
  text: string;
  redacted_count: number;
  truncated_count: number;
}

export function redactAndBoundEngineeringText(input: string, maxChars: number): RedactedBoundText
```

It should apply the shared secret redaction, local path/home redaction, then bounding. It must return real counts from the helpers, not inferred counters.

- [ ] **Step 3: Write failing adapter tests**

Create `tests/engineeringExperienceEpisode.test.ts` with a helper `ParsedCodexSession` containing:

- one user goal;
- one project context line;
- one key event;
- two duplicate commands;
- one command result;
- one assistant note;
- one final outcome;
- one referenced file under `process.env.HOME`;
- an event stream containing a command and result with the same `call_id`;
- parser drop counters.

Assert:

```ts
const { episode, quality } = buildCodexEngineeringEpisode(parsed());

expect(episode.episode_version).toBe(engineeringExperienceEpisodeVersion);
expect(episode.source_adapter).toBe("codex-engineering-adapter-v1");
expect(episode.problem_statement).toContain("...");
expect(episode.observed_sequence.some((item) => item.kind === "engineering_action" && item.source_channel === "commands")).toBe(true);
expect(episode.observed_sequence.some((item) => item.kind === "observed_result" && item.source_channel === "commandResults")).toBe(true);
expect(episode.observed_sequence.some((item) => item.provenance.call_id === "call-1")).toBe(true);
const home = process.env.HOME;
if (home) expect(JSON.stringify(episode)).not.toContain(home);
expect(JSON.stringify(episode)).not.toContain("likely_engineering_reviewable");
expect("quality" in episode).toBe(false);
expect(quality.has_problem).toBe(true);
expect(quality.has_action).toBe(true);
expect(quality.has_result).toBe(true);
```

Add one test proving duplicate commands are preserved as separate ordered observations:

```ts
expect(actions.map((item) => item.ordinal)).toEqual([1, 2]);
```

Add one test proving no final lesson words are introduced by the adapter:

```ts
expect(JSON.stringify(episode)).not.toContain("\"lesson\"");
expect(JSON.stringify(episode)).not.toContain("\"promotion\"");
```

Add one test proving the adapter prefers `parsed.engineeringEvents` over legacy arrays when that event stream exists:

```ts
expect(episode.observed_sequence.map((item) => item.provenance.source_event_ordinal)).toEqual([1, 2, 3]);
expect(episode.observed_sequence[1]?.provenance.call_id).toBe("call-1");
expect(episode.observed_sequence[2]?.provenance.call_id).toBe("call-1");
```

- [ ] **Step 4: Run failing adapter tests**

Run:

```bash
bun test tests/redaction.test.ts tests/engineeringExperienceEpisode.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement `src/engineeringExperienceEpisode.ts`**

Create the module with:

```ts
import type { ParsedCodexSession } from "./codexSessionParser.js";
import { redactAndBoundEngineeringText } from "./redaction.js";

export const engineeringExperienceEpisodeVersion = "engineering-experience-episode-v1";
export const codexEngineeringAdapterVersion = "codex-engineering-adapter-v1";

const maxHeaderTextChars = 1_000;
const maxItemTextChars = 1_000;
const maxObservedItems = 40;
```

Define the interfaces from the spec:

- `EngineeringExperienceItemKind`
- `EngineeringExperienceItem`
- `EngineeringExperienceEpisode`
- `EngineeringEpisodeQuality`
- `EngineeringEpisodeBuildResult`

Each `EngineeringExperienceItem.provenance` should include optional `source_event_ordinal`, `source_timestamp`, `raw_payload_type`, `call_id`, and `tool_name` when the parser captured them.

Implement:

```ts
export function buildCodexEngineeringEpisode(session: ParsedCodexSession): EngineeringEpisodeBuildResult
```

Mapping must be structural:

- `session.engineeringEvents` -> ordered `observed_sequence` when present;
- legacy `userGoals` -> `problem_statement` and `goal` items when no event stream is present;
- `projectContext` -> `engineering_context` and `context` items;
- `keyEvents` -> `source_event`;
- `commands` -> `engineering_action`;
- `commandResults` -> `observed_result`;
- `assistantNotes` -> `assistant_observation`;
- `outcomes` -> `final_outcome`;
- `filePaths` -> `referenced_file`.

Use `redactAndBoundEngineeringText(...)` for every displayed string. Do not hard-code `/Users/frankqdwang`.

Quality rule:

```ts
const likely_engineering_reviewable =
  has_problem && has_action && (has_result || has_outcome);
```

Quality notes should be plain debug notes such as:

- `Missing problem evidence.`
- `Missing engineering action evidence.`
- `Missing observed result or final outcome evidence.`

These notes are not rendered into corpus. Quality counters must include parser counters plus adapter redaction/truncation counts returned by `redactAndBoundEngineeringText(...)`.

- [ ] **Step 6: Re-run adapter tests**

Run:

```bash
bun test tests/redaction.test.ts tests/engineeringExperienceEpisode.test.ts
```

Expected: PASS.

---

## Task 3: Add Engineering Episode Renderer

**Files:**
- Create: `src/engineeringExperienceEpisodeWriter.ts`
- Create: `tests/engineeringExperienceEpisodeWriter.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Create `tests/engineeringExperienceEpisodeWriter.test.ts`.

Use `buildCodexEngineeringEpisode(parsed()).episode`, then render it.

Assert the rendered text contains:

```ts
expect(rendered).toContain("type: engineering-experience-episode");
expect(rendered).toContain("# Engineering Experience Episode");
expect(rendered).toContain("## Engineering Problem");
expect(rendered).toContain("## Workspace Context");
expect(rendered).toContain("## Observed Engineering Sequence");
expect(rendered).toContain("### Actions");
expect(rendered).toContain("- [commands] bun test");
expect(rendered).toContain("### Results");
expect(rendered).toContain("- [commandResults] 64 pass");
expect(rendered).toContain("## Trust Boundary");
expect(rendered).toContain("GBrain decides what, if anything, should be synthesized.");
```

Assert forbidden debug/verdict strings are absent:

```ts
expect(rendered).not.toContain("likely_engineering_reviewable");
expect(rendered).not.toContain("likely_dream_reviewable");
expect(rendered).not.toContain("Envelope quality");
expect(rendered).not.toContain("Malformed lines");
expect(rendered).not.toContain("Low-signal events");
expect(rendered).not.toContain("Secrets redacted");
expect(rendered).not.toContain("Text fields truncated");
expect(rendered).not.toContain("promotion");
expect(rendered).not.toContain("durable lesson");
```

Add a frontmatter escaping test using source-derived strings with quotes, colons, newlines, and `---`:

```ts
const injected = buildCodexEngineeringEpisode(parsed({
  sessionId: "abc\\ndef: injected\\n---",
})).episode;
const rendered = renderEngineeringExperienceEpisode(injected);

expect(rendered).toContain("source_id:");
expect(rendered).not.toMatch(/^def: injected$/m);
expect(rendered.match(/^---$/gm)).toHaveLength(2);
```

Use JSON-stringified scalar values or an equivalent safe scalar encoder for all frontmatter fields derived from source data.

- [ ] **Step 2: Run failing renderer tests**

Run:

```bash
bun test tests/engineeringExperienceEpisodeWriter.test.ts
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement `renderEngineeringExperienceEpisode`**

Create `src/engineeringExperienceEpisodeWriter.ts`:

```ts
import type { EngineeringExperienceEpisode, EngineeringExperienceItemKind } from "./engineeringExperienceEpisode.js";
import { boundText } from "./redaction.js";

export const engineeringEpisodeRendererVersion = "engineering-episode-renderer-v1";
```

Implement:

```ts
export function renderEngineeringExperienceEpisode(episode: EngineeringExperienceEpisode): string
```

Renderer rules:

- write YAML-like frontmatter with safe scalar strings;
- group `observed_sequence` by item kind;
- render each item as `- [source_channel] text`;
- preserve source order inside each section;
- never receive or render `EngineeringEpisodeQuality`;
- keep final text under the existing corpus guard using item-level bounds first.

- [ ] **Step 4: Re-run renderer tests**

Run:

```bash
bun test tests/engineeringExperienceEpisodeWriter.test.ts
```

Expected: PASS.

---

## Task 4: Wire Engineering Episodes Into The Collector

**Files:**
- Modify: `src/codexCollector.ts`
- Modify: `src/gbrainDreamCheck.ts`
- Modify: `tests/codexCollector.test.ts`
- Modify: `tests/gbrainDreamCheck.test.ts`

- [ ] **Step 1: Add failing collector tests**

In `tests/codexCollector.test.ts`, add or extend tests to assert:

- `codex-collect` writes `.engineering.txt` files under `.devbrain-teaching/dream-corpus/codex-engineering/`;
- raw envelope debug files, if written, are under `.devbrain-teaching/debug/envelopes/codex-sessions/`, not under the gbrain dream corpus;
- no gbrain command is invoked during collection;
- manifest sessions include `engineering_episode_quality`;
- report includes engineering episode totals;
- unchanged input does not rewrite the `.engineering.txt` file;
- raw envelope and engineering episode entries have separate paths and fingerprints.
- generated engineering corpus, raw envelope debug, state, and run paths are git-ignored with `git check-ignore --no-index`;
- the configured dream corpus directory contains engineering files only, not raw envelope files.
- POSIX generated directories are `0700` and generated files are `0600`;
- writes are atomic: temp files are renamed into place and stale temp files do not break later runs;
- legacy state with `transcript_path` / `fingerprint` is migrated without crashing;
- changing only parser version, redaction version, engineering adapter version, or renderer version rewrites the affected artifact.

Expected report strings:

```text
Engineering episode files written:
Engineering sessions with problem:
Engineering sessions with action:
Engineering sessions with result:
Engineering sessions with outcome:
Engineering likely reviewable:
Engineering evidence items:
Raw envelope debug files written:
```

Expected ignored paths:

```ts
for (const path of [
  ".devbrain-teaching/dream-corpus/codex-engineering/example.engineering.txt",
  ".devbrain-teaching/debug/envelopes/codex-sessions/example.envelope.txt",
  ".devbrain-teaching/state/codex-sessions.json",
  ".devbrain-teaching/runs/example/manifest.json",
]) {
  const result = spawnSync("git", ["check-ignore", "-q", "--no-index", "--", path], { cwd: process.cwd() });
  expect(result.status).toBe(0);
}
```

Expected manifest fields:

```ts
expect(session.engineering_episode).toMatchObject({
  episode_version: "engineering-experience-episode-v1",
  source_adapter: "codex-engineering-adapter-v1",
  transcript_path: expect.stringContaining(".devbrain-teaching/dream-corpus/codex-engineering/"),
  fingerprint: expect.any(String),
});
expect(session.engineering_episode_quality).toMatchObject({
  has_problem: true,
  has_action: true,
});
expect(session.raw_envelope).toMatchObject({
  transcript_path: expect.stringContaining(".devbrain-teaching/debug/envelopes/codex-sessions/"),
  fingerprint: expect.any(String),
});
```

- [ ] **Step 2: Run failing collector tests**

Run:

```bash
bun test tests/codexCollector.test.ts
```

Expected: FAIL because collector does not write engineering episode artifacts yet.

- [ ] **Step 3: Add engineering episode write path**

In `src/codexCollector.ts`:

1. Import:

```ts
import {
  buildCodexEngineeringEpisode,
  codexEngineeringAdapterVersion,
  engineeringExperienceEpisodeVersion,
} from "./engineeringExperienceEpisode.js";
import {
  engineeringEpisodeRendererVersion,
  renderEngineeringExperienceEpisode,
} from "./engineeringExperienceEpisodeWriter.js";
```

2. For each parsed session, build both:

```ts
const { envelope, quality: envelopeQuality } = buildCodexExperienceEnvelope(session);
const { episode, quality: engineeringQuality } = buildCodexEngineeringEpisode(session);
```

3. Split output directories:

```ts
const engineeringCorpusDir = resolve(options.engineeringCorpusDir ?? ".devbrain-teaching/dream-corpus/codex-engineering");
const rawEnvelopeDir = resolve(options.rawEnvelopeDir ?? ".devbrain-teaching/debug/envelopes/codex-sessions");
```

The configured gbrain dream corpus is `engineeringCorpusDir`. Raw envelopes are debug artifacts and must not be written under `engineeringCorpusDir`.

4. Write the engineering corpus path with a distinct suffix:

```ts
const engineeringTranscriptPath = join(engineeringCorpusDir, engineeringTranscriptFilename(session));
```

If the collector currently derives names in a helper, add helpers instead of ad hoc replacement:

```ts
function engineeringTranscriptFilename(session: ParsedCodexSession): string
function rawEnvelopeTranscriptFilename(session: ParsedCodexSession): string
```

5. Include these versions in the engineering fingerprint:

- `session.sourceSha256`
- `codexSessionParserVersion`
- `redactionVersion`
- `engineeringExperienceEpisodeVersion`
- `codexEngineeringAdapterVersion`
- `engineeringEpisodeRendererVersion`

6. Include these versions in the raw envelope fingerprint:

- `session.sourceSha256`
- `codexSessionParserVersion`
- `redactionVersion`
- `experienceEnvelopeVersion`
- `codexSessionAdapterVersion`
- `dreamRendererVersion` or the current raw envelope renderer version

Use a stable hash of a structured object rather than string concatenation:

```ts
function artifactFingerprint(parts: Record<string, string>): string {
  return sha256Hex(JSON.stringify(Object.keys(parts).sort().map((key) => [key, parts[key]])));
}
```

Use the repo's existing hash helper when one exists; otherwise implement `sha256Hex()` with `crypto.createHash("sha256")`.

7. Keep unchanged no-rewrite behavior:

- if source hash and raw envelope versions match previous state, skip rewriting the raw envelope debug file;
- if source hash and engineering versions match previous state, skip rewriting the engineering corpus file;
- if only engineering versions changed, rewrite only the engineering file and engineering state entry;
- if only raw envelope versions changed, rewrite only the raw envelope debug file and raw state entry.

- [ ] **Step 4: Split collector state shape**

Replace the single `transcript_path` / `fingerprint` session state with:

```ts
sessions: Record<
  string,
  {
    session_id: string;
    source_path: string;
    source_sha256: string;
    started_at?: string;
    updated_at: string;
    raw_envelope?: {
      transcript_path: string;
      fingerprint: string;
    };
    engineering_episode: {
      transcript_path: string;
      fingerprint: string;
    };
  }
>;
```

Extend `CollectCodexSessionsResult` with report-facing counters needed by dream diagnostics:

```ts
corpusDir: string; // Backward-compatible alias for engineeringCorpusDir.
engineeringCorpusDir: string;
rawEnvelopeDir: string;
engineeringEpisodeFilesWritten: number;
rawEnvelopeFilesWritten: number;
engineeringEvidenceItems: number;
engineeringLikelyReviewable: number;
engineeringWithProblem: number;
engineeringWithAction: number;
engineeringWithResult: number;
engineeringWithOutcome: number;
engineeringRedacted: number;
engineeringTruncated: number;
engineeringMalformed: number;
engineeringLowSignal: number;
```

Dream-cycle readiness must use the engineering corpus path. Prefer `result.engineeringCorpusDir`; keep `result.corpusDir` as a backward-compatible alias that points to the same engineering directory. Add a regression test that fails if `runCodexDreamCycle(...)` passes a raw envelope or old `codex-sessions` corpus path into `checkGbrainDreamReadiness(...)`.

Add tolerant state migration:

- old entries with `transcript_path` and `fingerprint` become `raw_envelope`;
- engineering entries are created on the next collection run;
- unknown future fields are preserved or ignored without throwing;
- malformed state still falls back to a fresh state with a warning in the run report.

- [ ] **Step 5: Add manifest and report quality totals**

Manifest per-session item should include compact metadata, not full rendered text:

```ts
engineering_episode: {
  episode_version: engineeringExperienceEpisodeVersion,
  source_adapter: codexEngineeringAdapterVersion,
  transcript_path: engineeringTranscriptPath,
  fingerprint: engineeringFingerprint,
},
engineering_episode_quality: engineeringQuality,
raw_envelope: {
  transcript_path: rawEnvelopeTranscriptPath,
  fingerprint: rawEnvelopeFingerprint,
},
```

Report aggregate counters:

```ts
engineeringEpisodeFilesWritten
engineeringEvidenceItems
engineeringWithProblem
engineeringWithAction
engineeringWithResult
engineeringWithOutcome
engineeringLikelyReviewable
engineeringRedacted
engineeringTruncated
engineeringMalformed
engineeringLowSignal
rawEnvelopeFilesWritten
```

Do not render `engineeringQuality.notes` into gbrain corpus files.

Use one shared private atomic writer for corpus, state, manifest, and report:

- create parent directory with `0o700`;
- write temp file in the same directory with `0o600`;
- best-effort `chmodSync(..., 0o600)`;
- rename temp file to final path;
- on POSIX tests, assert final mode bits.

Export or share this writer so `src/codexDreamCycle.ts` uses the same private atomic write path for `codex-dream-cycle.json` and `codex-dream-cycle.md`. Add tests proving dream-cycle reports are written owner-only and via temp-file rename instead of direct `writeFileSync`.

- [ ] **Step 6: Update dream readiness default corpus**

In `src/gbrainDreamCheck.ts`, change the default corpus directory from:

```ts
".devbrain-teaching/dream-corpus/codex-sessions"
```

to:

```ts
".devbrain-teaching/dream-corpus/codex-engineering"
```

Update readiness tests so `dream.synthesize.session_corpus_dir` is expected to match the engineering corpus, not the raw envelope debug directory.

Add warnings when:

- gbrain config still points to `.devbrain-teaching/dream-corpus/codex-sessions`;
- old `.devbrain-teaching/dream-corpus/codex-sessions/` is non-empty and is not the configured engineering corpus;
- the configured engineering corpus contains `*.envelope.txt`.

- [ ] **Step 7: Re-run collector and readiness tests**

Run:

```bash
bun test tests/codexCollector.test.ts tests/gbrainDreamCheck.test.ts
```

Expected: PASS.

---

## Task 5: Improve Dry-Run Dream Diagnostics

**Files:**
- Modify: `src/codexDreamCycle.ts`
- Modify: `tests/codexDreamCycle.test.ts`

- [ ] **Step 1: Add failing dry-run diagnostic tests**

In `tests/codexDreamCycle.test.ts`, add a fake gbrain runner test where `dream --dry-run --json` returns parseable JSON, for example:

```json
{
  "phase": "synthesize",
  "dry_run": true,
  "transcripts_considered": 47,
  "transcripts_selected": 0
}
```

Use a fake collector result that includes the extended `CollectCodexSessionsResult` fields and sets `engineeringLikelyReviewable > 0`. Assert the report JSON/Markdown stores:

- gbrain args include `dream`, `--dry-run`, `--json`;
- selected count is `0`;
- interpretation is `gbrain verdict remains conservative` when engineering quality totals show reviewable material;
- interpretation is `collector material appears weak` when quality totals show no result/outcome.

Add a second test where `dream --dry-run --json` exits non-zero with an unknown-flag error and plain `dream --dry-run` exits zero. Assert:

- the wrapper falls back to plain dry-run;
- report says JSON diagnostics were unavailable;
- the overall dry-run still succeeds.

Add a third test where `dream --dry-run --json` exits zero but returns malformed JSON. Assert:

- the cycle still writes a report;
- `diagnostics.available` is false;
- bounded stdout/stderr previews are preserved;
- interpretation is `diagnostic unavailable`.

Add command-wrapper coverage or an explicit CLI test proving both `codex-dream-cycle` and `codex-v5-dream-cycle` use this same implementation path.

Add a report-write test proving the cycle report uses the shared private atomic writer. On POSIX, assert `codex-dream-cycle.json` and `codex-dream-cycle.md` are `0600`. Also assert a stale temp file beside the report does not break a later run.

- [ ] **Step 2: Run failing dream-cycle tests**

Run:

```bash
bun test tests/codexDreamCycle.test.ts
```

Expected: FAIL because dry-run diagnostics are not parsed yet.

- [ ] **Step 3: Invoke JSON dry-run diagnostics when dry-run is requested**

In `src/codexDreamCycle.ts`, when `options.dryRun === true`, first try:

```ts
client.run(["dream", "--dry-run", "--json"]);
```

If `--dir` is present, preserve the existing argument order:

```ts
["dream", "--dir", brainDir, "--dry-run", "--json"]
```

If JSON output is malformed, keep the existing bounded stdout/stderr preview and set:

```ts
diagnostics.available = false;
diagnostics.parse_error = "...bounded...";
```

If `--json` is unsupported or exits non-zero with an unknown-flag style error, fall back to the existing plain dry-run args:

```ts
["dream", "--dry-run"]
```

or:

```ts
["dream", "--dir", brainDir, "--dry-run"]
```

Do not fail the cycle solely because JSON diagnostics are unavailable if the fallback gbrain dry-run exit code is `0`.

- [ ] **Step 4: Add interpretation logic for human reports**

Add a small deterministic helper:

```ts
function interpretDreamDryRun(
  engineeringLikelyReviewable: number,
  selectedCount: number | null,
): "collector material appears weak" | "gbrain verdict remains conservative" | "gbrain selected material" | "diagnostic unavailable"
```

Rules:

- if selected count is `null`, return `diagnostic unavailable`;
- if selected count is greater than `0`, return `gbrain selected material`;
- if selected count is `0` and engineering likely-reviewable count is greater than `0`, return `gbrain verdict remains conservative`;
- otherwise return `collector material appears weak`.

This interpretation is report-only and must not be written into corpus files.

The `engineeringLikelyReviewable` input must come from `CollectCodexSessionsResult` or the latest collect manifest/report data, not from parsing generated corpus text.

- [ ] **Step 5: Re-run dream-cycle tests**

Run:

```bash
bun test tests/codexDreamCycle.test.ts
```

Expected: PASS.

---

## Task 6: Update README And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the intended boundary**

Update `README.md` with a short section:

````markdown
## Engineering Experience Episodes

DevBrainTeaching prepares Codex App sessions as deterministic engineering raw material. It does not decide final lessons and does not write gbrain knowledge directly.

The flow is:

Codex session JSONL -> redacted parser output -> evidence envelope -> engineering episode -> gbrain dream/autopilot.

Use:

```bash
bun run codex-collect -- --limit 20
bun run gbrain-v5-dream-check
bun run codex-v5-dream-cycle -- --limit 20 --dry-run
```

`gbrain-v5-dream-check` should show that `dream.synthesize.session_corpus_dir` points to `.devbrain-teaching/dream-corpus/codex-engineering`, not the raw envelope debug directory.

If the dry-run selects zero transcripts, inspect the report:

- weak collector material means the adapter did not capture enough problem/action/result/outcome structure;
- conservative gbrain verdict means the material is present, but gbrain still did not judge it worth synthesis.
````

- [ ] **Step 2: Run the full test suite**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Run a local collection smoke test**

Run:

```bash
bun run codex-collect -- --limit 2
```

Expected:

- command exits `0`;
- `.devbrain-teaching/dream-corpus/codex-engineering/` contains `.engineering.txt` files;
- raw envelope debug files, if present, are under `.devbrain-teaching/debug/envelopes/codex-sessions/`;
- latest run report contains engineering episode totals.

- [ ] **Step 4: Run the v5 dry-run smoke test**

Run:

```bash
bun run codex-v5-dream-cycle -- --limit 20 --dry-run
```

Expected:

- command exits `0` when gbrain and the repo-local v5 runtime are configured;
- latest `codex-dream-cycle.md` includes dry-run diagnostics or a bounded explanation that JSON diagnostics were unavailable;
- report states whether the current result looks like weak collector material or conservative gbrain verdict.

If local gbrain credentials are unavailable, record the exact failure in the final build handoff instead of weakening the tests.

- [ ] **Step 5: Inspect generated corpus safety**

Run:

```bash
rg "likely_engineering_reviewable|likely_dream_reviewable|Envelope quality|Malformed lines|Low-signal events|Secrets redacted|Text fields truncated|durable lesson|promotion" .devbrain-teaching/dream-corpus/codex-engineering -g "*.engineering.txt"
```

Expected: no matches.

Run:

```bash
rg "/Users/frankqdwang" .devbrain-teaching/dream-corpus/codex-engineering -g "*.engineering.txt"
```

Expected: no matches. `$HOME` placeholders may appear in corpus files, but raw home paths must not.

- [ ] **Step 6: Final implementation self-review**

Before moving to `fw-review`, check:

- `EngineeringExperienceEpisode` does not contain quality/debug fields.
- Engineering quality appears only in state/manifest/report.
- Parser improvements are covered by fixtures.
- Parser event stream preserves source order and `call_id`.
- Fingerprints include parser and redaction versions.
- Legacy state migration is covered by tests.
- Generated files are atomic and owner-only where supported.
- Collector still never runs gbrain.
- Dream-cycle dry-run diagnostics are report-only.
- README states that gbrain, not DevBrainTeaching, owns durable synthesis.

---

## Commit

- [ ] Commit after implementation and verification:

```bash
git status --short
git add src tests README.md TODOS.md docs/superpowers/specs/2026-05-16-engineering-experience-episodes.md docs/superpowers/plans/2026-05-16-engineering-experience-episodes.md
git commit -m "feat: add engineering experience episodes"
```

Expected:

- working tree is clean after commit;
- commit contains implementation, tests, README update, spec, and plan;
- no generated `.devbrain-teaching/` corpus files are tracked.
