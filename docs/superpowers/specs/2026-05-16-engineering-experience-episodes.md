# Engineering Experience Episodes Spec

## Summary

Build a deterministic **Engineering Experience Episode** layer for Codex App sessions.

DevBrainTeaching should continue to be a non-invasive adapter: it collects, redacts, bounds, normalizes, and preserves source-backed engineering material. GBrain remains responsible for dream/autopilot verdicts, synthesis, long-term pages, facts, patterns, and durable knowledge.

This slice adapts the existing Codex-session corpus for the user's real input source: software-engineering sessions from Codex, not meetings, email, CEOs, people, or company-memory feeds.

## Problem

The current repo-local gbrain runtime and Codex collection path are wired, but the material still does not look useful to gbrain dream:

- `codex-v5-dream-cycle -- --limit 20 --dry-run` can run.
- GBrain can discover the generated transcript corpus.
- Recent reports showed `0` transcripts selected for synthesis.
- Recent collector quality showed many goals and tool calls, but `0` tool results and very few final outcomes.

The root cause is not only model strength. GBrain dream's default significance judge is tuned for new ideas, mental models, self-reflection, strategic calls, people, companies, and decisions. It is intentionally skeptical of routine operations and pure code debugging. Raw Codex logs and generic evidence envelopes do not yet present engineering episodes as coherent software-engineering raw material.

The wrong fix is to make DevBrainTeaching decide final lessons. That would move judgment out of gbrain and create a brittle hand-authored memory system.

## Product Direction

DevBrainTeaching should create source-backed engineering episodes:

```text
Codex session JSONL
  -> deterministic Codex parser
  -> generic experience evidence envelope
  -> engineering experience episode
  -> gbrain dream/autopilot verdict and synthesis
```

An engineering episode is not a final lesson. It is structured raw material that makes engineering work legible:

- What problem or constraint was being worked on?
- What actions were observed?
- What command or tool results were observed?
- What files, modules, or repo surfaces were involved?
- What final outcome was captured, if any?
- What source session did each item come from?

## Goals

1. Improve real Codex JSONL parsing so tool outputs and final outcomes from current sessions are captured when structurally available.
2. Add a deterministic `EngineeringExperienceEpisode` schema built from existing parsed session fields and source-backed evidence.
3. Render engineering-focused `.txt` corpus files that gbrain dream can discover without requiring an upstream gbrain fork.
4. Preserve the existing non-invasive boundary: no gbrain DB writes, no direct lesson creation, no pre-seeded gbrain verdicts.
5. Add collector and dream-cycle diagnostics that separate two cases:
   - the collector produced weak or incomplete engineering material;
   - the collector produced stronger material, but gbrain verdict remains conservative.
6. Avoid feeding the same Codex session to gbrain twice through both raw envelopes and engineering episodes.
7. Keep all engineering-quality signals out of the gbrain corpus body when they are debug/readiness hints rather than source evidence.
8. Keep unchanged sessions stable through fingerprinted, per-file writes.

## Non-Goals

- No upstream `/Users/frankqdwang/Agents/DevBrain` modifications.
- No gbrain DB writes from DevBrainTeaching.
- No `gbrain sources add`, `sync`, `embed`, `query`, or `call search` from the collector.
- No LLM call inside the collector or episode builder.
- No hand-authored durable lessons in DevBrainTeaching.
- No AGENTS.md, skill, memory, or teaching-topic promotion.
- No keyword classifier that turns "error", "fix", "test", or "decision" into final lesson semantics.
- No scheduler or recurring automation changes in this slice.
- No replacement of gbrain dream/autopilot as the owner of durable knowledge.

## Episode Contract

The episode schema is engineering-focused but still source-backed and deterministic.

```ts
export const engineeringExperienceEpisodeVersion = "engineering-experience-episode-v1";
export const codexEngineeringAdapterVersion = "codex-engineering-adapter-v1";

type EngineeringExperienceItemKind =
  | "goal"
  | "context"
  | "source_event"
  | "engineering_action"
  | "observed_result"
  | "assistant_observation"
  | "final_outcome"
  | "referenced_file";

interface EngineeringExperienceItem {
  kind: EngineeringExperienceItemKind;
  source_channel: string;
  text: string;
  ordinal: number;
  provenance: {
    source_kind: "codex-session";
    source_id: string;
    source_sha256: string;
    source_event_ordinal?: number;
    source_timestamp?: string;
    raw_payload_type?: string;
    call_id?: string;
    tool_name?: string;
  };
}

interface EngineeringExperienceEpisode {
  schema_version: 1;
  episode_version: typeof engineeringExperienceEpisodeVersion;
  source_kind: "codex-session";
  source_adapter: typeof codexEngineeringAdapterVersion;
  source_id: string;
  source_sha256: string;
  source_path_redacted: string;
  workspace_redacted?: string;
  started_at?: string;
  model?: string;
  problem_statement: string[];
  engineering_context: string[];
  observed_sequence: EngineeringExperienceItem[];
  trust_boundary: string[];
}

interface EngineeringEpisodeQuality {
  has_problem: boolean;
  has_action: boolean;
  has_result: boolean;
  has_outcome: boolean;
  evidence_count: number;
  redacted_count: number;
  truncated_count: number;
  malformed_count: number;
  low_signal_count: number;
  likely_engineering_reviewable: boolean;
  notes: string[];
}

interface EngineeringEpisodeBuildResult {
  episode: EngineeringExperienceEpisode;
  quality: EngineeringEpisodeQuality;
}
```

`EngineeringEpisodeQuality` is a debug artifact. It belongs in collector state, manifest, and reports. It must not be rendered into the gbrain corpus body.

The core `EngineeringExperienceEpisode` must not contain `quality`, `likely_engineering_reviewable`, or parser/debug counters.

## Parsed Evidence Event Contract

The parser should preserve a source-order evidence stream for the engineering adapter:

```ts
interface ParsedCodexEvidenceEvent {
  ordinal: number;
  timestamp?: string;
  source_channel: string;
  kind: EngineeringExperienceItemKind;
  text: string;
  call_id?: string;
  tool_name?: string;
  raw_payload_type?: string;
}
```

Existing parsed arrays such as `commands`, `commandResults`, and `outcomes` may remain for compatibility, but `buildCodexEngineeringEpisode(...)` should prefer the event stream when present. This keeps action/result ordering and explicit tool-call links without requiring DevBrainTeaching to infer success, failure, or lessons.

## Codex Mapping

The first adapter maps existing `ParsedCodexSession` fields through structural source channels:

- `userGoals` -> `problem_statement` and `kind = "goal"`
- `projectContext` -> `engineering_context` and `kind = "context"`
- `keyEvents` -> `kind = "source_event"`
- `commands` -> `kind = "engineering_action"`
- `commandResults` -> `kind = "observed_result"`
- `assistantNotes` -> `kind = "assistant_observation"`
- `outcomes` -> `kind = "final_outcome"`
- `filePaths` -> `kind = "referenced_file"`
- parser counters -> manifest/report quality debug only

When `ParsedCodexEvidenceEvent[]` is available, the adapter maps events directly into `observed_sequence` and copies `ordinal`, `timestamp`, `call_id`, `tool_name`, and `raw_payload_type` into item provenance. The older array mapping is a fallback only.

This adapter may rename structural channels into engineering language, but it must not decide that something is a reusable lesson, failure mode, best practice, or promotion candidate.

## Parser Requirements

The parser must cover current Codex JSONL shapes that appear in real sessions, including:

- `session_meta`
- `response_item`
- `event_msg`
- `payload.type = "message"` with `role = "user" | "assistant"`
- `payload.type = "user_message"`
- assistant final/commentary phases when structurally available
- function/tool calls that contain shell commands
- function/tool calls whose arguments use `cmd`, `command`, or command arrays such as `["bash", "-lc", "..."]`
- function/tool outputs that contain stdout/stderr/output/content fields
- function/tool outputs where `payload.output` is itself JSON wrapping `{ output, metadata }`
- event-level order, `call_id`, tool name, source timestamp, and raw payload type when present
- malformed JSONL lines
- encrypted or private reasoning entries that must be dropped
- large duplicated user/tool fields that must be bounded

The parser should still parse safely and never execute JSONL content.

Parser tests must include at least one fixture copied from the shape of a real local Codex session, reduced to non-sensitive fields. Synthetic fixtures that only use `arguments: {"cmd": "bun test"}` and `output: "..."` are not sufficient for this slice.

Final outcomes must come only from structural final markers, not keywords such as "done", "fixed", or "implemented". Allowed markers are:

- `payload.phase === "final"`
- `payload.phase === "final_answer"`
- `payload.channel === "final"`
- a response item whose structured metadata explicitly marks the assistant message as final/completed

Assistant text without a final marker should be stored as `assistant_observation`, not `final_outcome`.

## Redaction And Bounding Contract

All rendered engineering text must pass through one shared helper that returns both text and counters:

```ts
interface RedactedBoundText {
  text: string;
  redacted_count: number;
  truncated_count: number;
}

function redactAndBoundEngineeringText(input: string, maxChars: number): RedactedBoundText;
```

`EngineeringEpisodeQuality.redacted_count` and `EngineeringEpisodeQuality.truncated_count` must be calculated from real helper results plus parser counters. They must not be guessed from whether text changed.

## Corpus Layout

This slice must avoid duplicate gbrain consumption.

Default layout:

```text
.devbrain-teaching/
  dream-corpus/
    codex-engineering/
      YYYY-MM-DD-<safe-session-id>-<hash8>.engineering.txt
  debug/
    envelopes/
      codex-sessions/
        YYYY-MM-DD-<safe-session-id>-<hash8>.envelope.txt
```

`dream.synthesize.session_corpus_dir` should point to `.devbrain-teaching/dream-corpus/codex-engineering` for this workflow.

Raw experience envelopes may still be generated for debugging and regression tests, but they must not live in the configured gbrain dream corpus by default. If a future run intentionally wants both raw and engineering corpora, it needs an explicit corpus mode and a report warning about duplicated source sessions.

## Rendered Corpus Shape

Engineering episode files are `.txt` files in the configured gbrain dream corpus directory:

```text
YYYY-MM-DD-<safe-session-id>-<hash8>.engineering.txt
```

The body is markdown-style text with frontmatter:

```markdown
---
type: engineering-experience-episode
schema_version: 1
episode_version: "engineering-experience-episode-v1"
source_kind: codex-session
source_adapter: codex-engineering-adapter-v1
source_id: "..."
source_sha256: "..."
started_at: "..."
dream_generated: false
tags: ["engineering-experience", "codex-session", "raw-material"]
---

# Engineering Experience Episode

## Engineering Problem

## Workspace Context

## Observed Engineering Sequence
### Goals And Context
### Actions
### Results
### Assistant Observations
### Final Outcomes
### Referenced Files

## Trust Boundary
This is raw engineering evidence, not durable knowledge. GBrain decides what, if anything, should be synthesized.

## Source Appendix
```

Each rendered evidence item must show its source channel, for example:

```markdown
- [commands] bun test
- [commandResults] 64 pass 0 fail
```

The corpus body must not include:

- `likely_engineering_reviewable`
- `likely_dream_reviewable`
- `quality`
- parser/debug counters such as malformed, low-signal, redacted, or truncated counts
- hand-authored lesson verdicts
- promotion hints

## Dream Diagnostics

`codex-dream-cycle -- --dry-run` and `codex-v5-dream-cycle -- --dry-run` should preserve a human-readable report and attempt to capture machine-readable gbrain dry-run diagnostics when available.

The report should include:

- collected raw envelope count;
- collected engineering episode count;
- sessions with problem/action/result/outcome;
- gbrain dry-run command arguments;
- gbrain exit status;
- parsed gbrain dry-run selected count when JSON output is available;
- bounded stdout/stderr preview when JSON output is not available;
- whether JSON diagnostics were unavailable and the wrapper fell back to normal `gbrain dream --dry-run`;
- interpretation:
  - "collector material appears weak" when episode quality is low;
  - "gbrain verdict remains conservative" when episode quality is stronger but selected count is still zero.

The diagnostic interpretation is for humans only and must not be written into gbrain corpus files.

## Safety Rules

- Redaction runs before episode construction and rendering.
- No raw home path appears in corpus body.
- Secrets and credentials use the existing shared redaction path.
- Episode text fields are bounded at item level.
- Whole-file caps are final guards, not the main bounding mechanism.
- Generated corpus/state/run files remain under ignored `.devbrain-teaching/`.
- Both `.devbrain-teaching/dream-corpus/codex-engineering/` and `.devbrain-teaching/debug/envelopes/codex-sessions/` must be ignored and owner-only where supported.
- Generated files are owner-only where supported.
- Raw envelope and engineering episode fingerprints are tracked independently.
- Unchanged raw envelope files are not rewritten unless source hash, parser version, redaction version, raw-envelope schema version, raw-envelope adapter version, or raw-envelope renderer version changes.
- Unchanged engineering episode files are not rewritten unless source hash, parser version, redaction version, engineering episode schema version, engineering adapter version, or engineering renderer version changes.
- Generated file writes are atomic: write a temp file in the same directory, chmod best-effort owner-only, then rename into place.
- On POSIX platforms, generated directories should be `0700` and generated files should be `0600`.
- Legacy collector state with a single `transcript_path` / `fingerprint` must be read tolerantly and migrated to independent raw-envelope and engineering-episode state entries.
- Frontmatter scalar values must be safely escaped so source IDs or paths cannot inject new frontmatter fields.
- Dream readiness must warn when gbrain still points at the old raw `codex-sessions` corpus or when the configured engineering corpus contains raw envelope files.
- `codex-collect` must not invoke any gbrain command.
- `codex-dream-cycle --dry-run` may invoke `gbrain dream --dry-run --json`; if that is unsupported, it must fall back to `gbrain dream --dry-run`; full run still requires readiness.

## Acceptance Criteria

- `bun test` passes.
- Parser fixtures for real Codex `response_item` / `event_msg` tool-output shapes produce non-empty `commands`, `commandResults`, and `outcomes`.
- Parser fixtures cover `arguments.command` arrays and JSON-wrapped `payload.output`.
- Parser fixtures cover encrypted/private reasoning drops, malformed JSONL counts, content arrays/strings/objects, stdout/stderr/content fallback, huge output truncation, and structural-only final outcomes.
- Engineering episode items preserve source event order and explicit `call_id` when available.
- `bun run codex-collect -- --limit 2` writes `.engineering.txt` files under `.devbrain-teaching/dream-corpus/codex-engineering/`.
- Raw envelope debug files, if written, are outside the configured gbrain dream corpus.
- `codex-collect` does not call any gbrain command.
- Engineering episode corpus files contain source channels for actions and results.
- Engineering episode corpus files do not contain quality/debug hints, parser counters, or final lesson verdicts.
- Manifest and report include engineering episode quality totals:
  - sessions with problem;
  - sessions with action;
  - sessions with result;
  - sessions with outcome;
  - total engineering evidence items;
  - redacted/truncated/malformed/low-signal totals.
- Unchanged source sessions do not rewrite existing `.engineering.txt` files.
- Engineering and raw-envelope state entries have independent paths and fingerprints.
- Changing only parser version, redaction version, engineering adapter version, or engineering renderer version rewrites the affected artifact even when source hash is unchanged.
- Legacy state shape is migrated without crashing.
- Generated corpus, state, manifest, and report writes are atomic and owner-only where supported.
- Frontmatter escaping tests prevent injected fields from source-derived strings.
- `gbrain-v5-dream-check` expects `dream.synthesize.session_corpus_dir` to point at the engineering corpus directory.
- `gbrain-v5-dream-check` warns about stale old corpus/config paths and raw envelope files inside the configured engineering corpus.
- `codex-v5-dream-cycle -- --limit 20 --dry-run` writes a report that distinguishes collector quality from gbrain verdict conservatism.
- `codex-v5-dream-cycle -- --limit 20 --dry-run` falls back to non-JSON dry-run if `--json` is unavailable.
- README documents that DevBrainTeaching prepares Codex engineering raw material and gbrain owns durable synthesis.
