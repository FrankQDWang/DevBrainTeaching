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
bun run codex-ingest -- --limit 20
```

`doctor` checks that the gbrain CLI is callable. `candidates` currently prints
the read-only command plan for the first candidate-quality slice.

If the global `gbrain` command is not the checkout you want, point this project
at a specific binary:

```bash
GBRAIN_BIN=/path/to/gbrain bun run doctor
```

## Codex Session Ingestion

`codex-ingest` normalizes recent Codex App JSONL sessions into a compact,
git-ignored gbrain source instead of importing raw private logs.

```bash
LITELLM_BASE_URL=http://127.0.0.1:8787/v1 \
GBRAIN_EMBEDDING_MODEL=litellm:jina-embeddings-v4 \
GBRAIN_EMBEDDING_DIMENSIONS=1536 \
bun run codex-ingest -- --limit 20
```

Safety boundaries:

- `--limit` must be an integer from 1 to 20.
- `.devbrain-teaching/gbrain-sources/` must be ignored by git before any
  transcript is written.
- generated transcripts are written to a temp snapshot, then atomically replace
  `.devbrain-teaching/gbrain-sources/codex-sessions/transcripts/`.
- gbrain source registration uses dedicated non-federated source
  `codex-sessions`.
- run artifacts are written under `.devbrain-teaching/runs/<run-id>/`.
- verification uses source-scoped gbrain calls:
  `gbrain call --source codex-sessions search ...`.

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
