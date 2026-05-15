# Repo-Local GBrain V5 Runtime Spec

## Goal

Create an isolated DevBrainTeaching runtime for experimenting with gbrain using self-hosted `jina-embeddings-v5-text-small` on Apple Silicon, a repo-local `GBRAIN_HOME`, and an independent Postgres + pgvector database.

This runtime must not mutate or depend on the global `~/.gbrain` brain and must not reuse the currently running Bytedance/JD pgvector container.

## Background

DevBrainTeaching already has a safe Codex-session-to-gbrain adapter:

```text
Codex JSONL
  -> deterministic DevBrainTeaching collector
  -> safe .txt transcript corpus
  -> gbrain dream/autopilot
```

The current global gbrain config is a separate runtime:

```text
engine: pglite
database_path: /Users/frankqdwang/.gbrain/brain.pglite
embedding_model: litellm:jina-embeddings-v4
embedding_dimensions: 1536
```

The desired new runtime uses `jina-embeddings-v5-text-small`, whose public model card says it produces 1024-dimensional embeddings and supports the `retrieval`, `text-matching`, `clustering`, and `classification` tasks. The MLX model card says the Apple Silicon checkpoint stores one base model plus LoRA adapters, uses float16, has a 1.35 GB footprint, and supports runtime task switching.

## Product Boundary

DevBrainTeaching owns:

- local runtime setup around gbrain;
- deterministic checks and scripts;
- local model serving adapters;
- repo-local environment templates;
- diagnostics proving isolation and readiness.

GBrain owns:

- schema creation;
- pgvector storage;
- hybrid search;
- dream/autopilot synthesis;
- durable knowledge pages, facts, patterns, and search.

DevBrainTeaching must not import upstream gbrain TypeScript modules or write gbrain database tables directly.

## Runtime Layout

All generated runtime state must live under ignored `.devbrain-teaching/` paths:

```text
.devbrain-teaching/
  gbrain-v5/                 # GBRAIN_HOME parent; gbrain writes .gbrain/ inside it
  postgres-data/             # Docker Postgres volume mount
  models/
    jina-v5-text-small-mlx/  # downloaded MLX checkpoint
  runs/
  state/
```

The effective gbrain config path for this runtime is:

```text
.devbrain-teaching/gbrain-v5/.gbrain/config.json
```

## Required Architecture

Use four isolated pieces:

```text
DevBrainTeaching scripts
  -> repo-local GBRAIN_HOME=.devbrain-teaching/gbrain-v5
  -> independent Docker Postgres + pgvector on 127.0.0.1:55433
  -> local OpenAI-compatible MLX embedding endpoint on 127.0.0.1:8797/v1
  -> gbrain init/doctor/dream commands scoped by environment
```

The running Bytedance/JD gbrain container currently uses:

```text
container: bytedance-jd-gbrain-postgres
port: 127.0.0.1:55432
```

This runtime must use a different container name, Docker Compose project name, host port, database, user, and `GBRAIN_HOME`.

## First Slice Scope

Build only:

1. A repo-local runtime configuration module.
2. A Docker Compose file for independent Postgres + pgvector.
3. A local MLX embedding server that exposes OpenAI-compatible `/v1/embeddings` and `/health`.
4. CLI commands to:
   - print runtime environment values;
   - initialize the repo-local gbrain v5 brain;
   - run a readiness check;
   - set up the repo-local Python venv for the embedding server;
   - install, uninstall, start, stop, restart, and inspect the repo-local Jina v5 LaunchAgent.
5. Tests proving isolation, command construction, dimension consistency, and no accidental global gbrain usage.
6. README and `.env.example` updates for the v5 runtime.

## Non-Goals

- No migration of the existing global `~/.gbrain`.
- No reuse of the Bytedance/JD Postgres container.
- No direct use of the existing 1536-dimensional v4 brain.
- No gbrain source registration.
- No `gbrain sync`, `gbrain embed`, or `gbrain dream` in setup commands unless a later explicit run gate invokes them.
- No Jina cloud Classifier integration in this slice.
- No Jina cloud Segmenter integration in this slice.
- No Jina Reranker integration in this slice.
- No Reader or DeepSearch integration in this slice.

## Embedding Contract

The runtime must use these defaults:

```text
JINA_V5_MODEL_ID=jinaai/jina-embeddings-v5-text-small-mlx
JINA_V5_EMBEDDING_MODEL=jina-embeddings-v5-text-small
JINA_V5_EMBEDDING_DIMENSIONS=1024
JINA_V5_TASK=retrieval
JINA_V5_DOCUMENT_TASK_TYPE=retrieval.passage
JINA_V5_QUERY_TASK_TYPE=retrieval.query
JINA_V5_PROXY_HOST=127.0.0.1
JINA_V5_PROXY_PORT=8797
```

The OpenAI-compatible endpoint must accept requests shaped like:

```json
{
  "model": "litellm:jina-embeddings-v5-text-small",
  "input": ["text one", "text two"]
}
```

It must respond with:

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0]
    }
  ],
  "model": "jina-embeddings-v5-text-small",
  "usage": {
    "prompt_tokens": 0,
    "total_tokens": 0
  }
}
```

Implementation may return real token counts when available, but must always provide `prompt_tokens` and `total_tokens` for gbrain/LiteLLM compatibility.

## Postgres Contract

Use Docker only for Postgres in this slice:

```text
image: pgvector/pgvector:pg17
compose_project: devbrainteaching-gbrain-v5
container_name: devbrainteaching-gbrain-v5-postgres
host: 127.0.0.1
host_port: 55433
container_port: 5432
database: devbrainteaching_gbrain_v5
user: gbrain_v5
```

The password must come from `.env` and must not be committed.

The database URL must be constructed as:

```text
postgresql://gbrain_v5:<password>@127.0.0.1:55433/devbrainteaching_gbrain_v5
```

## GBrain Initialization Contract

Initialization must run gbrain under the repo-local environment:

```bash
GBRAIN_HOME=/Users/frankqdwang/Agents/DevBrainTeaching/.devbrain-teaching/gbrain-v5
GBRAIN_DATABASE_URL=postgresql://gbrain_v5:<password>@127.0.0.1:55433/devbrainteaching_gbrain_v5
LITELLM_BASE_URL=http://127.0.0.1:8797/v1
GBRAIN_EMBEDDING_MODEL=litellm:jina-embeddings-v5-text-small
GBRAIN_EMBEDDING_DIMENSIONS=1024
gbrain init --non-interactive --url postgresql://gbrain_v5:<password>@127.0.0.1:55433/devbrainteaching_gbrain_v5 --embedding-model litellm:jina-embeddings-v5-text-small --embedding-dimensions 1024
```

The command must run a deterministic init preflight before calling `gbrain init`.
The init preflight must check only facts that can be true before initialization.
It must not require `gbrain config show` to already report the target runtime,
because those config values are created by `gbrain init`.

`gbrain init` must not run if:

- the Postgres password is missing;
- the MLX embedding endpoint is unreachable;
- host port `55433` is not listening;
- host port `55433` is owned by a container other than `devbrainteaching-gbrain-v5-postgres`;
- `GBRAIN_HOME` resolves outside this repository;
- `JINA_V5_EMBEDDING_DIMENSIONS` is not `1024`.
- the embedding endpoint cannot return a real 1024-dimensional embedding for a small smoke input.
- `gbrain --version` fails under the repo-local environment.

`--dry-run` must not print the raw Postgres password. It may print a redacted
database URL such as:

```text
postgresql://gbrain_v5:***@127.0.0.1:55433/devbrainteaching_gbrain_v5
```

## Readiness Contract

Readiness is a post-initialization diagnostic. It may fail before the first
successful `gbrain init`; that failure must not block dry-run output and must
not be reused as init preflight.

The readiness command must report:

- runtime root;
- `GBRAIN_HOME`;
- gbrain config path;
- Postgres container name and port;
- whether Docker is callable;
- whether port `55433` is listening;
- whether the listening Docker container is `devbrainteaching-gbrain-v5-postgres`;
- whether `/health` on the MLX endpoint is reachable;
- whether `/v1/embeddings` returns a real 1024-dimensional vector for a smoke input;
- whether `gbrain --version` works under repo-local `GBRAIN_HOME`;
- whether the repo-local config file exists at `.devbrain-teaching/gbrain-v5/.gbrain/config.json`;
- whether the repo-local config file reports:
  - `engine: postgres`;
  - `embedding_model: litellm:jina-embeddings-v5-text-small`;
  - `embedding_dimensions: 1024`;
- whether the global `~/.gbrain` config was avoided.

Readiness must not require the Postgres password. The password is required for
`gbrain init`, but post-init diagnostics should be able to report missing or
partial local state without forcing the caller to expose credentials.

Readiness must not call `gbrain config show`. In current gbrain, `config show`
is routed through the DB-connected command path and may trigger connection work
or schema migration probes before rendering config. Readiness must inspect the
repo-local config file directly instead.

Every gbrain command issued by readiness or initialization must be launched
with the repo-local environment, including `GBRAIN_HOME`. The command runner
must make that environment explicit and testable; a runner that only receives
argv is not sufficient for this slice.

The `gbrain-v5-env` diagnostic command must not print the full process
environment or any value inherited from the caller shell. It may print only a
whitelisted, non-secret view of the repo-local runtime:

- `GBRAIN_HOME`;
- `LITELLM_BASE_URL`;
- `GBRAIN_EMBEDDING_MODEL`;
- `GBRAIN_EMBEDDING_DIMENSIONS`;
- `JINA_V5_EMBEDDING_MODEL`;
- `JINA_V5_EMBEDDING_DIMENSIONS`;
- model id, model dir, host, port, database name, database user, and container name.

Repo-local gbrain commands must not inherit ambient database, embedding, or
model-routing configuration from the caller shell. The runtime environment must
remove ambient values first, then inject only the repo-local overrides needed by
this runtime. It must remove or overwrite:

- `DATABASE_URL`
- `GBRAIN_DATABASE_URL`
- `GBRAIN_HOME`
- `LITELLM_BASE_URL`
- every `GBRAIN_EMBEDDING_*` key, then re-inject only `GBRAIN_EMBEDDING_MODEL`
  and `GBRAIN_EMBEDDING_DIMENSIONS` for v5;
- every `GBRAIN_CHAT_*` key;
- `GBRAIN_EXPANSION_MODEL`;
- `GBRAIN_REMOTE_CLIENT_SECRET`.

The readiness command must not call:

- `gbrain config show`;
- `gbrain sources add`;
- `gbrain sync`;
- `gbrain embed`;
- `gbrain dream`;
- any command that writes gbrain pages.

## Deferred Jina Capabilities

### Reranker

Jina Reranker can be valuable after the base runtime has measurable retrieval quality. It should not be included now because gbrain already has keyword + vector + RRF + cosine rescore + boosts + dedup. Adding an external reranker before a baseline makes quality changes hard to attribute.

### Classifier

Jina has downloadable v5 classification models and the MLX multi-task model can switch to `classification`. This is useful later for deterministic session routing and dream candidate triage, but it should not block the first runtime slice.

### Segmenter

Jina Segmenter is available as an API. A repo-local deterministic segmenter is the better first fit for private Codex material because chunking can be implemented without cloud calls. This belongs in a later corpus-quality slice.

### Reader / DeepSearch

Reader and DeepSearch are external-material ingestion tools. They should be kept out of this runtime slice because they expand the product boundary from local Codex material to internet research.

## Acceptance Criteria

- `bun test` passes.
- `docker compose -f docker-compose.gbrain-v5.yml config` succeeds.
- New runtime paths are ignored by git.
- `bun run gbrain-v5-env` prints only whitelisted repo-local environment values, never points at `~/.gbrain`, and never prints API keys, tokens, secrets, passwords, or the full caller environment.
- `bun run gbrain-v5-check` reports safe diagnostics without mutating gbrain pages.
- `bun run gbrain-v5-init -- --dry-run` prints the exact initialization command and environment without executing gbrain init.
- `bun run gbrain-v5-init` refuses to run without a Postgres password.
- `bun run jina-v5-setup` installs server dependencies into `.devbrain-teaching/venv`, not the system Python environment.
- `bun run jina-v5-service -- install|status|restart|stop|uninstall` manages a repo-generated LaunchAgent under `.devbrain-teaching/state/` and a login-level copy under `~/Library/LaunchAgents/`.
- The v5 embedding endpoint health response reports model `jina-embeddings-v5-text-small` and dimensions `1024`.
- Tests prove the command runner injects repo-local `GBRAIN_HOME`.
- Tests prove the command runner does not call direct source ingestion or dream commands during readiness.
- README explains that this is an isolated experimental runtime, not the global production brain.

## External References

- Jina v5 text small model: https://huggingface.co/jinaai/jina-embeddings-v5-text-small
- Jina v5 text small MLX model: https://huggingface.co/jinaai/jina-embeddings-v5-text-small-mlx
- Jina API overview: https://jina.ai/en-US/segmenter/
- GBrain local engine documentation: `/Users/frankqdwang/Agents/DevBrain/docs/ENGINES.md`
- GBrain embedding dimension migration notes: `/Users/frankqdwang/Agents/DevBrain/docs/embedding-migrations.md`
