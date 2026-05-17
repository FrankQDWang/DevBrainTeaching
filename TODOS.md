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

## Runtime JSON Schema Validation

- **What:** Add JSON Schema files for `experience-evidence-envelope-v1`, `experience-envelope-quality-v1`, `engineering-experience-episode-v1`, and `engineering-episode-quality-v1`, then validate generated artifacts in tests and optionally at runtime.
- **Why Needed:** These envelopes and engineering episodes are cross-system contracts between collectors, future adapters, and gbrain-facing corpus renderers. Runtime validation would catch shape drift that TypeScript alone cannot catch.
- **Why Deferred:** The immediate build is still defining the first stable engineering episode shape. Adding schema tooling now would expand the slice before the core adapter and renderer are proven.
- **Scope:** Future `schemas/` directory plus validation tests after the first engineering episode implementation lands.

## Lightweight Provenance Graph

- **What:** Add richer event-level provenance such as source JSONL line offsets, observed timestamps, adapter activity metadata, and source-to-envelope generation metadata.
- **Why Needed:** It would make each evidence item auditable beyond session-level `source_sha256` and support future debugging or replay.
- **Why Deferred:** The current slice now plans the minimum useful provenance: event order, timestamp, raw payload type, and explicit call IDs when present. A full provenance graph with line offsets, generated-entity metadata, and replay relationships would expand the slice beyond the current safety and corpus-shape work.
- **Scope:** Future parser/envelope upgrade that preserves offsets and timestamps without adding semantic judgment.

## Tool Call And Result Correlation

- **What:** Preserve explicit or adapter-derived links between a tool call and its corresponding result.
- **Why Needed:** It would help gbrain understand which output belongs to which action without DevBrainTeaching inferring success or failure.
- **Why Deferred:** The current slice should preserve explicit `call_id` links when Codex provides them. More ambitious inferred correlation, such as matching missing call IDs by order or proximity, should wait until explicit correlation is proven on real fixtures.
- **Scope:** Future Codex parser and envelope adapter enhancement for inferred or graph-mode correlation only when clearly safe.

## Generated JSON Envelope Artifacts

- **What:** Write ignored `.devbrain-teaching/envelopes/*.json` artifacts alongside `.txt` dream corpus files.
- **Why Needed:** JSON artifacts would simplify schema validation, regression tests, debugging, and future non-Markdown consumers.
- **Why Deferred:** The current gbrain dream path consumes `.txt` transcripts. Adding parallel JSON output increases generated-file surface area and cleanup concerns.
- **Scope:** Future debug artifact behind the same git-ignore and owner-only safety checks.

## Agent Event Semantic Conventions

- **What:** Define stable internal event names such as `experience.tool.call`, `experience.tool.result`, and `experience.message.assistant.final` across Codex, CI, review, and other future adapters.
- **Why Needed:** It would keep multi-source adapters consistent as the evidence layer grows.
- **Why Deferred:** The current slice only has one adapter and can use the simpler `kind` plus `source_channel` contract.
- **Scope:** Future adapter framework work after Codex evidence envelopes prove useful in gbrain dream.

## Golden Corpus Snapshot Tests

- **What:** Add checked-in golden fixtures for representative source sessions and expected rendered corpus output.
- **Why Needed:** Golden tests would catch accidental corpus-shape drift, missing source channels, leaked debug counters, and unstable ordering.
- **Why Deferred:** The first build already includes focused behavior tests. Golden snapshots are more valuable after the v1 shape stops changing.
- **Scope:** Future regression suite under `tests/fixtures/` and `tests/golden/`.

## Dream Review Diagnostic Matrix

- **What:** Add report-only diagnostics comparing generated corpus count, structurally reviewable envelope count, missing-goal/action/result counts, and gbrain selected-for-synthesis count.
- **Why Needed:** It would explain whether `0 selected` means weak collected material or conservative gbrain verdict behavior.
- **Why Deferred:** The current slice first needs to produce clean envelope quality totals. A matrix is a reporting enhancement on top of that.
- **Scope:** Future `codex-v5-dream-cycle` report section that remains outside the gbrain corpus body.

## Clustering And Community Detection

- **What:** Run offline clustering or community detection over accumulated engineering episodes to find recurring failure modes, verification habits, repeated architectural boundaries, and cross-project problem families.
- **Why Needed:** Once gbrain has absorbed enough high-quality engineering episodes, clustering can reveal patterns that are hard to see from one session at a time.
- **Why Deferred:** The current slice is still building the safe raw-material adapter. Adding clustering now would push DevBrainTeaching toward analysis and judgment before the corpus is reliable.
- **Scope:** Future offline analysis job over generated episodes or gbrain-synthesized records, not part of `codex-collect`.

## Privacy Tier

- **What:** Classify evidence as public-safe, repo-local-sensitive, secret-redacted, or private-dropped before rendering or reporting.
- **Why Needed:** Redaction removes obvious secrets, but long-term operation benefits from knowing which evidence is safe to expose, which is local-only, and which was removed.
- **Why Deferred:** The current slice already needs redaction, bounding, owner-only files, and corpus separation. A richer privacy taxonomy should come after the basic safety path is verified.
- **Scope:** Future quality/report metadata and optional render policy. Do not put privacy verdict hints into the gbrain corpus body unless explicitly designed.

## Diff-Aware Engineering Episodes

- **What:** Enrich episodes with source-backed repo-change signals such as files edited, tests run before/after, error deltas, and changed modules.
- **Why Needed:** Many software-engineering lessons live in the relationship between a code change, a command, and a verification result.
- **Why Deferred:** This requires reliable git/session correlation and could accidentally infer success or lesson semantics. The current slice should first preserve session evidence faithfully.
- **Scope:** Future deterministic adapter extension using source-backed git/session evidence only.

## Engineering Episode Graph Artifact

- **What:** Emit a debug-only graph representation with nodes for goals, actions, results, observations, and outcomes, plus edges such as `produced`, `followed_by`, or `references_file`.
- **Why Needed:** A graph artifact would make debugging and later analysis easier than parsing markdown text.
- **Why Deferred:** The current gbrain dream path consumes `.txt` corpus files. Adding graph JSON now increases artifact surface area and schema work before the text corpus is validated.
- **Scope:** Future ignored debug artifact under `.devbrain-teaching/debug/`, paired with schema validation and owner-only writes.
