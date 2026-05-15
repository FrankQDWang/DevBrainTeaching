# Deferred Extensions

These items are intentionally not in the current Codex sessions gbrain autopilot adapter slice. They are useful, but adding them now would expand the first build beyond the safety-critical collector and dream readiness path.

## Transcript Adapter Framework

- **What:** Generalize the Codex-only collector into a `SessionAdapter` framework for Codex App, Claude Code, OpenClaw, Cursor logs, CI repair transcripts, and gbrain friction logs.
- **Why Needed:** The long-term product should ingest multiple agent/workflow transcript sources through the same safety boundary.
- **Why Deferred:** The current risk is not lack of source variety; it is getting one source safely into gbrain dream without manual synthesis or direct source ingestion.
- **Scope:** Future abstraction after Codex collection, redaction, state, and dream cycle are proven.

## Full Capability-Driven GBrain Integration

- **What:** Add explicit probes for gbrain transcript extension support, `dream --json`, `dream --phase synthesize`, `dream --input`, dry-run cost behavior, and Minions/autopilot availability.
- **Why Needed:** It would reduce hardcoded assumptions as gbrain evolves.
- **Why Deferred:** The immediate plan can rely on verified local gbrain 0.33.1.0 behavior plus conservative `.txt` output and readiness checks.
- **Scope:** Future `gbrain-capabilities` module used by `gbrain-dream-check`.

## Stale Source Cleanup Command

- **What:** Add `bun run gbrain-codex-source-cleanup -- --dry-run` and `--archive --yes` to archive or remove the invalid old `codex-sessions` gbrain source record.
- **Why Needed:** The stale source currently points at a deleted filesystem path and can confuse future checks.
- **Why Deferred:** It mutates the local gbrain database, so it should be a separate explicit gate after the non-mutating adapter is reviewed.
- **Scope:** Future migration utility with metadata backup and dry-run default.

## Deterministic Salience Hints

- **What:** Add non-authoritative collector hints such as commands seen, tests passed/failed, files mentioned, explicit decisions, and truncation flags.
- **Why Needed:** These hints could help gbrain's verdict model decide which transcripts are worth synthesis.
- **Why Deferred:** The first version should avoid making DevBrainTeaching look like the knowledge judge. It should expose safe raw material first.
- **Scope:** Future transcript metadata section once gbrain dream consumption quality is measured.

## Rich Trust Banner

- **What:** Add a longer prompt-injection and trust-boundary banner to every generated transcript.
- **Why Needed:** It reminds synthesis agents that transcripts are untrusted raw material containing failed attempts and stale assumptions.
- **Why Deferred:** A compact trust note is enough for the first slice; a larger banner may add noise to every transcript.
- **Scope:** Future rendering tweak if gbrain synthesis shows over-trust in raw session content.

