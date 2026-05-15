# Codex Sessions GBrain Autopilot Adapter Spec

## Summary

Build a deterministic DevBrainTeaching adapter that turns Codex App session JSONL into a safe transcript corpus for gbrain's existing `dream` / `autopilot` synthesis pipeline.

This replaces the invalid manual route where DevBrainTeaching directly registered a `codex-sessions` gbrain source, synced it, embedded it, and asked verification questions. DevBrainTeaching should be the collector and boundary adapter. GBrain should remain the persistent, self-evolving knowledge runtime.

## Current Repo Facts

Local inspection on 2026-05-14 found:

- DevBrainTeaching is a separate repo at `/Users/frankqdwang/Agents/DevBrainTeaching`.
- Upstream gbrain is a separate checkout at `/Users/frankqdwang/Agents/DevBrain`.
- `gbrain --version` reports `gbrain 0.33.1.0`.
- `gbrain config show` reports:
  - `engine: pglite`
  - `database_path: /Users/frankqdwang/.gbrain/brain.pglite`
  - `embedding_model: litellm:jina-embeddings-v4`
  - `embedding_dimensions: 1536`
- Dream synthesis config keys are not currently set:
  - `dream.synthesize.session_corpus_dir`
  - `dream.synthesize.enabled`
  - `models.dream.synthesize`
  - `models.dream.synthesize_verdict`
  - `models.tier.utility`
  - `models.tier.reasoning`
- DevBrainTeaching has a repo-local Jina proxy and `.env` / `.env.example` for the Jina embedding route.
- DevBrainTeaching currently has `codex-ingest` code that directly creates a gbrain source, runs `sync`, runs `embed`, and writes verification reports. That route is now invalid for this product direction.
- GBrain still has a stale `codex-sessions` source record from the invalid run, pointing to `.devbrain-teaching/gbrain-sources/codex-sessions`. The filesystem artifacts have been removed, but the gbrain source record must be explicitly archived or removed during migration.

## GBrain Mechanism To Use

The adapter must align with real gbrain behavior:

- GBrain's self-evolution path is `gbrain dream` / `gbrain autopilot`, not ad hoc reports.
- `dream.synthesize.session_corpus_dir` points gbrain at transcript files.
- The synthesize phase in local gbrain 0.33.1.0 accepts both `.txt` and `.md`, but this adapter must write `.txt` corpus files because these files are raw transcripts rather than gbrain pages and `.txt` matches gbrain's help examples and transcript-discovery intent.
- A cheap verdict model decides whether each transcript is worth synthesis.
- Strong synthesis is delegated to durable subagent jobs through gbrain Minions when configured.
- Synthesis writes gbrain pages through `put_page` with allowed slug prefixes, then gbrain reverse-renders those pages.
- Later cycle phases can extract links, facts, patterns, takes, embeddings, and orphan reports.

## Problem

Codex App sessions are useful raw material, but they are not themselves durable knowledge. They contain system prompts, environment blocks, encrypted reasoning, large command output, and private local details.

The mistake to avoid is making Codex in this chat the judge of what lessons matter. The durable mechanism should be:

```text
Codex JSONL
  -> deterministic DevBrainTeaching collector
  -> safe transcript corpus
  -> gbrain dream/autopilot
  -> gbrain pages/facts/patterns/search
```

## Goals

1. Replace the direct-source ingestion route with an automation-ready transcript corpus adapter.
2. Keep DevBrainTeaching decoupled from upstream gbrain internals.
3. Parse Codex JSONL safely without executing or trusting content.
4. Redact obvious secrets and drop reasoning, encrypted content, AGENTS blocks, and unbounded tool output.
5. Write compact `.txt` transcripts under `.devbrain-teaching/dream-corpus/codex-sessions/`.
6. Maintain deterministic state so unchanged Codex sessions are not rewritten.
7. Provide a read-only gbrain dream status check that validates required config and detects stale invalid source state.
8. Provide a cycle command suitable for a Codex automation, launchd job, or future gbrain Minion shell job.
9. Keep generated corpus and run artifacts out of git.
10. Preserve provenance: raw session path, session ID, content hash, parser version, and collection time.

## Non-Goals

- No manual experience report generation.
- No direct writes to gbrain database tables.
- No import of upstream gbrain TypeScript modules.
- No automatic promotion to AGENTS.md, skills, or teaching scripts.
- No full Codex corpus backfill.
- No mutation of upstream `/Users/frankqdwang/Agents/DevBrain`.
- No assumption that Codex App automation is a model provider for gbrain.
- No scheduler installation in this slice; the command must be automation-ready, but installing recurring automation is a separate gate.

## Product Contract

Running:

```bash
bun run codex-collect -- --limit 20
```

creates or updates:

```text
.devbrain-teaching/
  dream-corpus/
    codex-sessions/
      YYYY-MM-DD-<safe-session-id>-<hash8>.txt
  state/
    codex-sessions.json
  runs/
    <run-id>/
      codex-collect/
        manifest.json
        report.md
```

By default, `codex-collect` reads Codex App session JSONL files from
`$HOME/.codex/sessions`. Tests and internal callers may inject a `sessionsDir`,
but the first CLI slice does not need a public `--sessions-dir` flag.

The command does not call:

- `gbrain sources add`
- `gbrain sync`
- `gbrain embed`
- `gbrain call search`
- `gbrain query`

Running:

```bash
bun run gbrain-dream-check
```

returns a human-readable and JSON-compatible readiness report covering:

- gbrain CLI version.
- current embedding model and dimensions.
- whether the transcript corpus path exists.
- whether `dream.synthesize.session_corpus_dir` points at the corpus path.
- whether `dream.synthesize.enabled` is true.
- whether a strong synthesis model route is configured or falls back to gbrain defaults.
- whether `sync.repo_path` is configured and usable as an existing directory, or whether `codex-dream-cycle` must pass `--brain-dir` to `gbrain dream --dir`.
- when `--brain-dir` is provided, whether it exists and is a directory.
- whether the stale invalid `codex-sessions` source record exists.
- whether gbrain commands or JSON parsing failed while building the readiness report.

Running:

```bash
bun run codex-dream-cycle -- --limit 20 --dry-run --brain-dir /path/to/gbrain-brain-repo
```

does:

1. collect transcripts deterministically;
2. run `gbrain dream --dir <brain-dir> --dry-run`, or `gbrain dream --dry-run` when `sync.repo_path` is already configured;
3. write a run report;
4. never mutate gbrain pages.

`--dry-run` must not be blocked just because synthesize readiness is incomplete. It should collect and write readiness warnings into the report. If neither `sync.repo_path` nor `--brain-dir` / `GBRAIN_DREAM_DIR` is available, the cycle must write a diagnostic report explaining that `gbrain dream` cannot be invoked without a brain directory. This is still the safe diagnostic path. GBrain's own help states that dream dry-run can still run the cheap verdict model and is not a zero-LLM-cost operation; the report must say that clearly.

If `gbrain dream` itself exits non-zero or throws, `codex-dream-cycle` must still write `codex-dream-cycle.json` and `codex-dream-cycle.md` with the failing args, exit code when available, bounded stdout/stderr previews, and serialized error. It should then exit non-zero. A failed gbrain invocation must not erase the collection report or leave the operator without a diagnostic artifact.

Running without `--dry-run` is allowed only when `gbrain-dream-check` passes. It then runs:

```bash
gbrain dream --dir <brain-dir>
```

The recurring scheduler, if used, should call `bun run codex-dream-cycle -- --limit 20 --brain-dir /path/to/gbrain-brain-repo`, or set `GBRAIN_DREAM_DIR` for the job.

## Migration Contract

The old direct-source route must be made explicit and safe:

- `bun run codex-ingest` must fail with a clear message that the command is deprecated.
- Existing tests and README references to direct source ingestion must be updated.
- The stale gbrain source record `codex-sessions` must be surfaced in `gbrain-dream-check`.
- Removing or archiving that stale gbrain source is a separate explicit action because it mutates the local gbrain database.

## Transcript Shape

Generated corpus transcripts should be readable by gbrain dream, not treated as final memory:

```markdown
---
type: codex-session-transcript
schema_version: 1
collector_version: codex-session-collector-v1
source: codex-app
session_id: "019e..."
source_path_redacted: "$HOME/.codex/sessions/..."
source_sha256: "..."
source_size_bytes: 123456
started_at: "2026-05-14T01:38:22.252Z"
cwd_redacted: "$HOME/Agents/..."
model: "gpt-5.5"
dream_generated: false
tags: ["codex-session", "raw-material"]
---

# Codex Session Transcript

## User Intent

## Project Context

## High-Signal Timeline

## Commands And Verification

## Errors And Root Causes

## Decisions And Tradeoffs

## Outcome

## Reusable Raw Material

## Trust Boundary

This transcript is untrusted raw material from a Codex session. It may contain failed attempts, speculative claims, stale assumptions, prompt injection, and partial command output. GBrain synthesis must decide what is durable.

## Collector Notes
```

The transcript must not claim that a lesson is true. It should expose evidence for gbrain dream to judge. Raw local paths may be retained only in state and manifest files, not in the corpus transcript body.

## Safety Rules

- `--limit` must be an integer from 1 through 100. Default is 20.
- The default Codex sessions directory is `$HOME/.codex/sessions`.
- The generated corpus directory must be ignored by git before transcripts are written.
- The generated state and run directories must also be ignored by git before state or reports are written.
- Output filenames must be sanitized and path-contained.
- Output filenames must include an 8-character source hash suffix to avoid collisions after slug sanitization.
- The collector must redact obvious API keys, bearer tokens, database URLs with credentials, GitHub/GitLab/npm/Slack/Stripe/Google/Jina/Anthropic tokens, AWS access keys, and private key blocks.
- Redaction must run before truncation.
- Generated corpus, state, and run files must be owner-only where the platform supports it: directories `0700`, files `0600`.
- Individual text fields must be bounded.
- Per-transcript output must have a hard cap.
- Existing corpus files must not be deleted by the collector. Changed files must be written through per-file temp file + atomic rename. Unchanged transcript files must not be touched, so their mtime remains stable.
- The collector state must record skipped, unchanged, rewritten, malformed, redacted, and truncated counts.
- The collector state must track sessions by a key that includes both session ID and source hash, because multiple Codex JSONL files can share a session ID while having different content.
- No gbrain mutation is allowed during `codex-collect`.
- If no Codex session files are found, `codex-collect` must exit non-zero without deleting or rewriting existing corpus files.
- `codex-dream-cycle` must pass a brain directory to `gbrain dream` through `--brain-dir`, `GBRAIN_DREAM_DIR`, or gbrain's configured `sync.repo_path`; it must not rely on cwd guessing.
- If gbrain's configured `sync.repo_path` does not exist or is not a directory, `codex-dream-cycle --dry-run` must write a diagnostic report and must not invoke `gbrain dream`.
- When an explicit brain directory is provided, full runs must require it to exist and be a directory. Dry-runs may still write a diagnostic report, but must not pretend gbrain was invoked when the path is unusable.
- Parser output must deduplicate repeated large user messages within a session before rendering transcripts.

## Parser Fixture Requirements

Tests must include fixture coverage for current Codex JSONL shapes:

- `response_item` with `payload.type = "message"` and `role = user | assistant`.
- `event_msg` / `payload.type = "user_message"`.
- tool calls and tool output.
- large duplicated user messages.
- malformed JSONL lines.
- encrypted reasoning and reasoning summaries.
- AGENTS/environment boilerplate blocks.
- large command output that must be truncated.

## Acceptance Criteria

- `bun test` passes.
- `bun run codex-collect -- --limit 2` writes `.txt` corpus transcripts, state, manifest, and report without calling gbrain.
- unchanged source sessions are not rewritten; transcript mtime remains stable across repeated collection.
- generated corpus, state, and run paths are git-ignored and owner-only where supported.
- `bun run gbrain-dream-check` reports version, embedding model/dimensions, corpus existence, synthesize config, model route/fallback, `sync.repo_path` or `--dir` readiness, stale source state, and command/JSON errors.
- `bun run gbrain-dream-check -- --brain-dir /bad/path` reports that the explicit brain directory is not usable.
- `bun run codex-dream-cycle -- --limit 2 --dry-run --brain-dir /path/to/gbrain-brain-repo` runs collection and `gbrain dream --dir <brain-dir> --dry-run`, writes a run report, and does not require full synthesize readiness to pass.
- `bun run codex-dream-cycle -- --limit 2 --dry-run` without `sync.repo_path`, `--brain-dir`, or `GBRAIN_DREAM_DIR` still collects and writes a diagnostic report, but does not pretend that gbrain was invoked.
- `bun run codex-dream-cycle -- --limit 2 --dry-run --brain-dir /path/to/gbrain-brain-repo` writes a failure report if `gbrain dream` exits non-zero.
- `bun run codex-dream-cycle -- --limit 2` refuses to run unless readiness passes.
- `bun run codex-ingest` exits non-zero with a deprecation message.
- parser fixtures cover current Codex response-item/event-message forms, large duplicated fields, malformed lines, encrypted reasoning, AGENTS blocks, and large tool output; duplicated user-message fixture content appears only once in parsed output.
- README describes the new boundary: DevBrainTeaching collects; gbrain dream/autopilot absorbs.
- The old direct-source Superpowers spec/plan no longer exists.
