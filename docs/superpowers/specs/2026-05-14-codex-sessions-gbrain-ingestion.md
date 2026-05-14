# Codex Sessions GBrain Ingestion Spec

## Summary

Build the first ingestion slice that turns recent Codex App session JSONL files
into a small, searchable gbrain source without importing the raw 4GB corpus
directly. The slice recursively discovers the latest 20 sessions by parsed
session timestamp when available, then file mtime, then filename fallback. It
normalizes them into compact transcripts, registers a stable isolated gbrain
source, embeds them through the existing Jina proxy route, and verifies that
gbrain can answer practical developer experience questions from the imported
material.

## Context

The user works primarily in Codex App and wants gbrain to absorb development
experience over time. Local inspection on 2026-05-14 found:

- `gbrain 0.33.1.0` is installed and callable.
- The default brain is PGLite at `/Users/frankqdwang/.gbrain/brain.pglite`.
- Embeddings are configured as `litellm:jina-embeddings-v4`; the current local
  brain expects 1536
  dimensions.
- The current brain is sparse: 1 page, 1 chunk, 1 embedded chunk.
- `~/.codex/sessions` contains 2320 JSONL files and is about 4.1GB.
- `~/.codex/archived_sessions` is about 483MB.
- DevBrainTeaching is an output layer; gbrain remains the knowledge substrate.

GBrain has native transcript synthesis and search surfaces, but Codex session
JSONL contains large system prompts, repeated tool output, encrypted reasoning,
and other low-signal fields. Raw sessions should be retained as provenance, not
bulk-imported as first-class search pages.

## Problem

If raw Codex session files are imported directly, gbrain search will be polluted
with platform boilerplate and long tool logs. The useful long-term knowledge is
the distilled development experience:

- User goal and project context.
- Key repo paths and modules touched.
- Errors, failed attempts, and root causes.
- Decisions and tradeoffs.
- Verification commands and outcomes.
- Final result and reusable lesson.

The first slice must prove this normalized layer is useful before any automated
daily ingestion or full backfill is enabled.

## Goals

1. Parse Codex session JSONL safely without executing or trusting content.
2. Normalize the latest 20 sessions into compact Markdown transcripts.
3. Preserve raw session file paths and session IDs as provenance.
4. Filter low-signal content such as base instructions, encrypted reasoning,
   long raw tool output, and repeated environment context.
5. Register a dedicated gbrain source for the normalized transcripts.
6. Sync and embed the source with the existing gbrain CLI.
7. Run a fixed verification question set and save the results.
8. Keep all generated artifacts under `.devbrain-teaching/`.
9. Keep generated transcript source material out of git by ignoring
   `.devbrain-teaching/gbrain-sources/`.
10. Enforce runtime guardrails before writing private transcripts: validated
    `--limit`, git-ignore confirmation, safe transcript filenames, redaction,
    bounded transcript size, and non-destructive failure behavior.

## Non-Goals

- No full 4GB backfill.
- No automatic recurring ingestion.
- No direct writes to the gbrain database.
- No changes to `/Users/frankqdwang/Agents/DevBrain`.
- No reliance on gbrain internal TypeScript modules.
- No extraction of private facts into gbrain hot memory in this slice.
- No automatic deletion, pruning, or mutation of original Codex session files.

## Product Contract

Running:

```bash
bun run codex-ingest -- --limit 20
```

creates a run directory:

```text
.devbrain-teaching/
  gbrain-sources/
    codex-sessions/
      transcripts/
        YYYY-MM-DD-<safe-session-id>.md
  runs/
    <run-id>/
      codex-sessions/
        manifest.json
        verification.json
        verification.md
```

The command then:

1. Ensures a gbrain source named `codex-sessions` points at the stable absolute
   `.devbrain-teaching/gbrain-sources/codex-sessions` directory.
2. Requires `.devbrain-teaching/gbrain-sources/` to be ignored by git before
   any real Codex session transcript is written there.
3. Registers the source with `--no-federated` for this first slice, so it does
   not pollute default cross-source search before quality is proven.
4. Runs `gbrain sync --source codex-sessions --no-pull`.
5. Runs `gbrain embed --stale`.
6. Executes five verification searches with
   `gbrain call --source codex-sessions search '<json>'`. The plain
   `gbrain query --source ...` CLI form is not a valid source-scoped query
   boundary in the observed `gbrain 0.33.1.0` CLI.
7. Writes query results and pass/follow-up notes to `verification.json` and
   `verification.md`.

## Normalized Transcript Format

Each generated Markdown file uses this shape:

```markdown
---
type: codex-session
schema_version: 1
source: codex-app
session_id: "019e..."
source_path: "/Users/frankqdwang/.codex/sessions/..."
source_sha256: "..."
source_size_bytes: 123456
cwd: "/Users/frankqdwang/Agents/..."
started_at: "2026-05-14T01:38:22.252Z"
model: "gpt-5.5"
parser_version: "codex-session-parser-v1"
tags: ["codex-session"]
---

# Codex Session: <short title>

## User Goal

...

## Project Context

- CWD: ...
- Repo or workspace: ...

## Key Events

- ...

## Decisions And Tradeoffs

- ...

## Errors And Root Causes

- ...

## Verification

- `bun test` -> passed

## Outcome

...

## Reusable Lessons

- ...

## Commands

- `bun test`

## Referenced Files

- `<workspace>/src/index.ts`

## Parser Notes

- Malformed JSONL lines dropped: 0
- Low-signal events dropped: 42
- Text fields truncated: 3
- Secrets redacted: 1
```

## Safety And Boundaries

- `--limit` must be an integer from 1 through 20 for this first slice. Invalid,
  zero, negative, `NaN`, or larger values must fail before session discovery.
- Latest session selection means descending by parsed session start timestamp
  when available, otherwise file modification time, otherwise filename.
- Each transcript should target 20KB and must hard-cap at 50KB. Individual text
  fields must be truncated to a bounded preview, with truncation counts recorded.
- The parser must redact obvious secrets from user/assistant text, shell command
  strings, command output summaries, and verification artifacts before writing
  them.
- Session IDs must remain provenance only. File names must use a sanitized slug,
  and transcript writes must assert the final path stays inside the transcript
  directory.
- The stable source directory is a regenerated snapshot of the latest N sessions.
  Replacement must not delete the existing transcript snapshot until the new
  transcript set has been rendered successfully.
- Generated transcript writes must be refused unless a sample path under
  `.devbrain-teaching/gbrain-sources/codex-sessions/transcripts/` is ignored by
  git at runtime.

## Filtering Rules

The parser must keep:

- `session_meta.payload.id`, timestamp, cwd, model, and originator.
- User messages.
- Assistant messages in `commentary` and `final` phases.
- Shell command names, call IDs, exit codes, and concise command output summaries
  from paired `function_call` / `function_call_output` events.
- File paths from tool calls and final answers.

The parser must drop:

- `base_instructions`.
- `developer_instructions`.
- `encrypted_content`.
- Raw reasoning payloads.
- Assistant messages outside `commentary` and `final`, including `analysis`.
- Large tool outputs beyond a bounded preview.
- Repeated AGENTS.md instruction blocks, except the target cwd and project rules
  summary.

## Verification Questions

The first slice is successful only if the verification report includes usable
results for at least three of these five questions. Each row must include
`usable`, `notes`, and `follow_up`; the report must include `pass_count` and
`passed`.

The user-facing questions are mapped to compact source-scoped search terms
because the first slice verifies retrievability of transcript sections rather
than polished semantic answer generation.

1. `What recurring mistakes or failure modes appeared in recent Codex work?`
   Search: `Errors Root Causes failed`
2. `Which verification commands are recurring in recent Codex sessions?`
   Search: `Verification bun test`
3. `What reusable development lessons should be retained from recent Codex work?`
   Search: `Reusable Lessons`
4. `Which gbrain or embedding setup decisions were made recently?`
   Search: `gbrain embedding Jina`
5. `What project outcomes were completed in recent Codex sessions?`
   Search: `Outcome verified`

## Error Behavior

- If no session files exist, exit non-zero with a clear message.
- If `--limit` is invalid, exit non-zero before discovering or writing sessions.
- If the generated transcript source path is not ignored by git, exit non-zero
  before writing any transcript.
- If a session file has malformed JSONL lines, skip only those lines and record
  the count in `manifest.json`.
- If gbrain is not callable, write transcripts and manifest, then exit non-zero
  before source registration.
- If `sources add` says the source already exists, inspect `gbrain sources list
  --json` and reuse it only when `local_path` equals the stable source directory.
  If available, also require a local source type and `federated === false`. If it
  points elsewhere or is federated, exit non-zero with the observed source
  metadata and do not remove or mutate that source automatically.
- If sync or embedding fails, write the failure into `verification.json` and
  `verification.md`, then exit non-zero.
- The generated source directory must be initialized as its own private git
  repository and committed before sync, because `gbrain sync --source` requires
  a source-local git `HEAD`.

## Acceptance Criteria

- `bun run codex-ingest -- --limit 20` produces transcripts, manifest, and
  verification artifacts.
- Invalid limits such as `0`, `abc`, `-1`, and `100000` fail without full corpus
  discovery or transcript writes.
- `.devbrain-teaching/gbrain-sources/` is confirmed ignored before transcript
  writes.
- The raw session files are never modified.
- `bun test` passes.
- `bun run doctor` passes.
- `gbrain stats` shows more than the initial 1 page after sync.
- `verification.json` records `pass_count >= 3`, `passed: true`, and
  source-scoped query outputs for the verification question set.

## Future Slices

- Add structured experience cards alongside Markdown transcripts.
- Add curated promotion from raw normalized `codex-sessions` into a separate
  long-term lessons source.
- Add bilingual verification queries for Chinese user goals and English tool
  output.
- Add incremental ingestion state keyed by session ID and source hash.
- Add golden query regression tests and repository-specific verification habit
  summaries.
