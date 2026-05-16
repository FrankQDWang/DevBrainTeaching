# Experience Evidence Envelope Spec

## Summary

Build a generic evidence-envelope layer between raw agent sessions and gbrain dream/autopilot.

DevBrainTeaching should not decide which sessions are durable lessons. It should turn each source session into a bounded, redacted, source-backed evidence package with a stable schema. GBrain remains responsible for verdict, synthesis, pages, facts, patterns, and durable knowledge.

This slice upgrades the current Codex-session transcript corpus from chat-shaped summary to evidence-shaped raw material without adding project-specific rules, keyword classifiers, or hand-authored lesson extraction.

## Problem

The current v5 pipeline works mechanically:

- `gbrain-v5-check` is ready.
- `gbrain-v5-dream-check` is ready.
- `codex-v5-dream-cycle -- --limit 20 --dry-run` runs successfully.
- GBrain sees the transcript queue.

But the dry-run verdict reports `0` transcripts selected for synthesis. The runtime path is usable, but the material shape is not yet useful enough for gbrain dream.

The wrong fix is adding brittle rules such as "if text contains error, mark it as failure" or "if command contains test, mark it as verification." That moves judgment from gbrain into DevBrainTeaching and violates the desired boundary.

## Product Direction

DevBrainTeaching should produce a generic **Experience Evidence Envelope**:

```text
raw source session
  -> deterministic source adapter
  -> source-agnostic evidence envelope
  -> gbrain-readable envelope transcript
  -> gbrain dream verdict/synthesis
```

The envelope is not a lesson. It is a standardized evidence packet. It should expose what happened, where it came from, and how complete the packet is. It must not decide what is true, durable, reusable, or promotable.

## Goals

1. Add a source-agnostic envelope schema that can represent Codex sessions now and other agent/session sources later.
2. Keep DevBrainTeaching deterministic: collect, redact, bound, normalize, preserve provenance, and render.
3. Make the generated `.txt` corpus envelope-first so gbrain can see goals, context, observed source events, tool calls, tool results, assistant commentary, assistant final output, and source appendix without reading a chat log end-to-end.
4. Preserve the existing safe collector guarantees: git-ignore enforcement, owner-only generated files, atomic writes, stable state, no gbrain mutation during collection.
5. Add quality/debug signals to manifest and report only, so operators can tell whether a session has enough observable structure for dream review.
6. Avoid project-specific, keyword-driven, or lesson-like classification rules.
7. Keep `codex-v5-dream-cycle --dry-run` as the primary validation path.

## Non-Goals

- No direct gbrain DB writes.
- No `gbrain sources add`, `sync`, `embed`, `query`, or `call search` from the collector.
- No automatic lesson classification in DevBrainTeaching.
- No AGENTS.md, skill, memory, or teaching-topic promotion.
- No keyword classifier for failure, fix, verification, decision, or lesson.
- No model call inside the collector.
- No scheduler installation.
- No changes to upstream `/Users/frankqdwang/Agents/DevBrain`.

## Envelope Contract

The core envelope is source-agnostic. Codex is only the first adapter.

```ts
type ExperienceSourceKind = string;

type ExperienceEvidenceKind =
  | "source_event"
  | "tool_call"
  | "tool_result"
  | "assistant_commentary"
  | "assistant_final"
  | "referenced_file";

interface ExperienceEvidenceEnvelope {
  schema_version: 1;
  envelope_version: "experience-evidence-envelope-v1";
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

interface ExperienceEvidenceItem {
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

interface ExperienceEnvelopeQuality {
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

interface ExperienceEnvelopeBuildResult {
  envelope: ExperienceEvidenceEnvelope;
  quality: ExperienceEnvelopeQuality;
}
```

`ExperienceEnvelopeQuality` is a debug artifact. It belongs in collector state, manifest, and report. It must not be rendered into the gbrain corpus body.
The core `ExperienceEvidenceEnvelope` must not contain a `quality`, `likely_dream_reviewable`, or debug-counter field.

## Codex Adapter Mapping

The first adapter maps the existing `ParsedCodexSession` into the generic envelope using structural fields only:

- `userGoals` -> `goal`
- `projectContext` -> `context`
- `keyEvents` -> `evidence.kind = "source_event"`
- `commands` -> `evidence.kind = "tool_call"`
- `commandResults` -> `evidence.kind = "tool_result"`
- `assistantNotes` -> `evidence.kind = "assistant_commentary"`
- `outcomes` -> `evidence.kind = "assistant_final"`
- `filePaths` -> `evidence.kind = "referenced_file"`
- parser counters -> manifest/report quality debug only

The adapter must not infer failure, fix, verification, or decision from keywords. If a future source provides explicit typed events, a future adapter may pass through those structural types, but this Codex adapter must not invent them from text.
The Codex adapter should be exposed as `buildCodexExperienceEnvelope(session): ExperienceEnvelopeBuildResult`; generic renderer functions should accept only `ExperienceEvidenceEnvelope`.

## Rendered Corpus Shape

The `.txt` file that gbrain sees should become envelope-first:

```markdown
---
type: experience-evidence-envelope
schema_version: 1
envelope_version: "experience-evidence-envelope-v1"
source_kind: codex-session
source_adapter: codex-session-adapter-v1
source_id: "..."
source_sha256: "..."
started_at: "..."
dream_generated: false
tags: ["experience-evidence", "raw-material"]
---

# Experience Evidence Envelope

## Goal

## Context

## Observed Evidence
### Source Events
### Tool Calls
### Tool Results
### Assistant Commentary
### Assistant Final Output
### Referenced Files

## Trust Boundary
This is raw evidence, not durable knowledge. GBrain decides what, if anything, should be synthesized.

## Source Appendix
```

The corpus body should not include `likely_dream_reviewable` or any equivalent hint. That hint is for humans and tests, not for gbrain verdict.
The corpus body should not include parser/debug counters such as malformed line counts, low-signal event counts, truncation counts, or redaction counts.
Each rendered evidence item should show its observed `source_channel`, for example `- [commands] bun test`.

## Quality Debug Contract

The collector manifest and report must include envelope quality totals:

- sessions with goal
- sessions with source event
- sessions with tool call
- sessions with tool result
- sessions with assistant final output
- sessions with `likely_dream_reviewable`
- total evidence items
- redacted, truncated, malformed, and low-signal counts

The report should make it clear when gbrain still selects `0` transcripts whether the collector produced weak material or whether gbrain verdict remains conservative despite stronger material.

## Safety Rules

- Redaction runs before envelope construction and rendering.
- Redaction uses the existing shared redaction path and must not hard-code a local username or absolute home path.
- No raw absolute home path appears in the corpus body.
- Envelope text fields are bounded at item level before rendering; a whole-file cap is only a final guard and must not be the main bounding mechanism. The v1 budget should keep normal rendered corpus files under the 50KB renderer guard.
- Evidence item count is bounded per session, and the bound should be low enough that item count times item text cap cannot exceed the renderer guard.
- The envelope adapter must not add another silent dedupe pass. Repeated parsed evidence may be meaningful. Existing parser-level compaction remains part of the parser contract and is reflected through parser drop counters.
- Generated corpus and debug artifacts remain under ignored `.devbrain-teaching/`.
- Existing unchanged transcript files are not rewritten unless source hash, parser version, renderer version, redaction version, adapter version, or envelope version changes.
- The old `codex-collect` command remains valid; it now writes envelope-first corpus files.
- `gbrain-v5-dream-check` and `codex-v5-dream-cycle` remain the preferred v5 commands.

## Acceptance Criteria

- `bun test` passes.
- `bun run codex-collect -- --limit 2` writes envelope-first `.txt` corpus files.
- The corpus body contains observed source channels, not lesson verdicts or debug readiness hints.
- `ExperienceEvidenceEnvelope` does not contain `quality`, `likely_dream_reviewable`, or debug counters.
- The corpus body does not contain `likely_dream_reviewable`, `Envelope quality`, `Low-signal events`, `Text fields truncated`, `Secrets redacted`, or `Malformed lines`.
- `manifest.json` includes per-session envelope quality information.
- `report.md` includes aggregate envelope quality totals, including redacted, truncated, malformed, and low-signal counts.
- `bun run gbrain-v5-dream-check` reports ready.
- `bun run codex-v5-dream-cycle -- --limit 20 --dry-run` runs successfully and records v5/1024 readiness in its report.
- The collector still does not invoke any gbrain command.
- The generated corpus still stays ignored by git and owner-only.
- No code path classifies any item as a durable lesson, promotion candidate, AGENTS.md change, skill, or memory.
- Evidence item ordering is stable and the envelope adapter does not silently drop duplicate parsed evidence except through explicit item-count bounds recorded in quality/report counters.
