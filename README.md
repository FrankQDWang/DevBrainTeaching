# DevBrain Teaching

DevBrain Teaching is a separate teaching-video output layer for a local
`gbrain` installation.

## Boundary

This project should stay decoupled from the upstream gbrain checkout:

- Do not modify `/Users/frankqdwang/Agents/DevBrain` for product-specific
  teaching workflows.
- Read gbrain through stable CLI/MCP surfaces first.
- Store teaching candidates, review reports, briefs, and later video artifacts
  under this project.
- Propose small upstream gbrain patches only when a missing generic API blocks
  the workflow.

## Local Layout

```text
/Users/frankqdwang/Agents/
  DevBrain/          # clean upstream gbrain clone
  DevBrainTeaching/  # this project
```

## First Commands

```bash
bun run doctor
bun run candidates
bun run gbrain-dream-check
```

`doctor` checks that the gbrain CLI is callable. `candidates` currently prints
the read-only command plan for the first candidate-quality slice.

If the global `gbrain` command is not the checkout you want, point this project
at a specific binary:

```bash
GBRAIN_BIN=/path/to/gbrain bun run doctor
```

## Codex Session Corpus For GBrain Dream

DevBrainTeaching does not decide which Codex lessons are durable. It prepares
safe raw material for gbrain's `dream` / `autopilot` mechanism.

```bash
bun run codex-collect -- --limit 20
bun run gbrain-dream-check
GBRAIN_DREAM_DIR=/path/to/gbrain-brain-repo bun run codex-dream-cycle -- --limit 20 --dry-run
```

`codex-collect` writes compact `.txt` transcripts under
`.devbrain-teaching/dream-corpus/codex-sessions/`. `gbrain-dream-check`
verifies whether gbrain is configured to read that corpus. `codex-dream-cycle
-- --dry-run` is the safe diagnostic path when `GBRAIN_DREAM_DIR`,
`--brain-dir`, or gbrain `sync.repo_path` identifies the brain repo; gbrain
dry-run may still spend cheap verdict-model tokens. A recurring scheduler
should use `codex-dream-cycle -- --limit 20 --brain-dir /path/to/gbrain-brain-repo`
only after readiness passes.

The old `codex-ingest` command is deprecated because it directly registered a
gbrain source and embedded Codex sessions. That bypassed gbrain's
self-evolving dream/autopilot boundary.

## Jina v4 Embedding Proxy

This repository can adapt Jina v4 to the global gbrain CLI without modifying
the gbrain checkout. The proxy exposes an OpenAI-compatible `/v1/embeddings`
endpoint and forwards requests to Jina.

```bash
export JINA_API_KEY=...
export JINA_EMBEDDING_DIMENSIONS=1536
bun run jina-smoke
bun run jina-proxy
```

In another shell, point gbrain's existing LiteLLM-compatible provider at the
local proxy. The proxy can hold the Jina key, so gbrain does not need direct
Jina support or a Jina-specific API key config:

```bash
export LITELLM_BASE_URL=http://127.0.0.1:8787/v1
export GBRAIN_EMBEDDING_MODEL=litellm:jina-embeddings-v4
export GBRAIN_EMBEDDING_DIMENSIONS=1536
```

Then run the gbrain command that needs embeddings, for example:

```bash
gbrain embed --stale
```

Note: current gbrain `providers test --model litellm:...` is not a reliable
test for this route because the LiteLLM recipe uses a dynamic model list. Use
`bun run jina-smoke` for the Jina API check and the proxy `/health` endpoint
for the local adapter check.
