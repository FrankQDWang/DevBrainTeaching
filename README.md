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

## Engineering Experience Episodes

DevBrainTeaching prepares Codex App sessions as deterministic engineering raw
material. It does not decide final lessons and does not write gbrain knowledge
directly. GBrain owns durable synthesis through `dream` / `autopilot`.

The flow is:

```text
Codex session JSONL -> redacted parser output -> evidence envelope -> engineering episode -> gbrain dream/autopilot
```

```bash
bun run codex-collect -- --limit 20
bun run gbrain-dream-check
GBRAIN_DREAM_DIR=/path/to/gbrain-brain-repo bun run codex-dream-cycle -- --limit 20 --dry-run
```

`codex-collect` writes engineering-focused `.engineering.txt` transcripts under
`.devbrain-teaching/dream-corpus/codex-engineering/`. It may also write raw
debug envelopes under `.devbrain-teaching/debug/envelopes/codex-sessions/`,
but those debug files are not the configured dream corpus by default.

`gbrain-dream-check` should show that
`dream.synthesize.session_corpus_dir` points to
`.devbrain-teaching/dream-corpus/codex-engineering`, not the raw debug envelope
directory or the old `.devbrain-teaching/dream-corpus/codex-sessions` path.

`gbrain-dream-check`
verifies whether gbrain is configured to read the engineering corpus.
`codex-dream-cycle -- --dry-run` is the safe diagnostic path when
`GBRAIN_DREAM_DIR`,
`--brain-dir`, or gbrain `sync.repo_path` identifies the brain repo; gbrain
dry-run may still spend cheap verdict-model tokens. A recurring scheduler
should use `codex-dream-cycle -- --limit 20 --brain-dir /path/to/gbrain-brain-repo`
only after readiness passes.

If a dry-run selects zero transcripts, inspect the cycle report:

- weak collector material means the adapter did not capture enough
  problem/action/result/outcome structure;
- conservative gbrain verdict means the material is present, but gbrain still
  did not judge it worth synthesis.

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

## Repo-Local GBrain V5 Runtime

The v5 runtime is an isolated experiment surface. It does not use the global
`~/.gbrain` config and does not reuse other running pgvector containers.
DevBrainTeaching owns only the local runtime boundary: Compose, environment
templates, diagnostics, and local embedding serving. GBrain still owns schema,
storage, search, dream/autopilot, and durable knowledge output.

Runtime state is generated under ignored `.devbrain-teaching/` paths:

```text
.devbrain-teaching/
  gbrain-v5/
  postgres-data/
  models/jina-v5-text-small-mlx/
```

Start the independent Postgres + pgvector container:

```bash
export GBRAIN_V5_POSTGRES_PASSWORD=...
docker compose -f docker-compose.gbrain-v5.yml up -d
```

Start the local MLX embedding server:

```bash
bun run jina-v5-setup
bun run jina-v5-mlx-server
```

For a persistent local service, install the repo-owned LaunchAgent instead:

```bash
bun run jina-v5-service -- install
bun run jina-v5-service -- status
```

Use `bun run jina-v5-service -- restart` after changing the server script or
environment, `bun run jina-v5-service -- stop` when you want to unload it for
the current login session, and `bun run jina-v5-service -- uninstall` to remove
the login-level LaunchAgent. The source plist is generated under ignored
`.devbrain-teaching/state/`, then copied to `~/Library/LaunchAgents/` for
login persistence. It uses `.devbrain-teaching/venv/bin/python`, not the system
Python package environment.

Check readiness:

```bash
bun run gbrain-v5-env
bun run gbrain-v5-check
GBRAIN_DREAM_DIR=/path/to/gbrain-brain-repo bun run gbrain-v5-dream-check
```

Initialize the repo-local gbrain config:

```bash
GBRAIN_V5_POSTGRES_PASSWORD=... bun run gbrain-v5-init -- --dry-run
GBRAIN_V5_POSTGRES_PASSWORD=... bun run gbrain-v5-init
```

Note: upstream `gbrain init` currently prints a generic message saying the
config was saved to `~/.gbrain/config.json`. In this runtime, the wrapper
launches gbrain with repo-local `GBRAIN_HOME`, so the real config path is:

```text
.devbrain-teaching/gbrain-v5/.gbrain/config.json
```

Use the wrapper's `Repo-local config:` line and `bun run gbrain-v5-check` as
the source of truth for the active config path.

The runtime uses `jina-embeddings-v5-text-small` at 1024 dimensions. Existing
1536-dimensional v4 brains must not be mixed with this runtime.

Use the v5 dream wrappers for Codex-session absorption:

```bash
bun run codex-collect -- --limit 20
GBRAIN_DREAM_DIR=/path/to/gbrain-brain-repo bun run gbrain-v5-dream-check
GBRAIN_DREAM_DIR=/path/to/gbrain-brain-repo bun run codex-v5-dream-cycle -- --limit 20 --dry-run
```

`gbrain-v5-dream-check` and `codex-v5-dream-cycle` inject the repo-local
`GBRAIN_HOME`, local Jina v5 endpoint, 1024-dimensional embedding route, and
v5 Postgres URL before calling gbrain. Prefer them over the generic
`gbrain-dream-check` / `codex-dream-cycle` commands when working with this
runtime; the generic commands intentionally reflect whatever gbrain
environment the current shell already has.
