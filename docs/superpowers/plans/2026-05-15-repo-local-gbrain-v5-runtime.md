# Repo-Local GBrain V5 Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated repo-local gbrain v5 runtime using independent Docker Postgres + pgvector and a local MLX `jina-embeddings-v5-text-small` embedding endpoint.

**Architecture:** DevBrainTeaching remains a boundary adapter. It owns local runtime scripts, environment construction, diagnostics, and the OpenAI-compatible MLX embedding service; upstream gbrain owns schema, storage, search, and dream/autopilot. All runtime state stays under ignored `.devbrain-teaching/` paths and all gbrain calls run with repo-local `GBRAIN_HOME`.

**Tech Stack:** Bun, TypeScript, Docker Compose, `pgvector/pgvector:pg17`, Python MLX, Hugging Face Hub, gbrain CLI.

**Spec:** `docs/superpowers/specs/2026-05-15-repo-local-gbrain-v5-runtime.md`

---

## File Structure

- Create: `src/gbrainV5Runtime.ts`
  - Owns repo-local paths, default ports, environment construction, Docker/gbrain command arguments, redacted dry-run output, preflight checks, and readiness checks.
- Create: `tests/gbrainV5Runtime.test.ts`
  - Tests path isolation, dimension defaults, env injection, command construction, and readiness non-mutation.
- Create: `scripts/jina_v5_mlx_server.py`
  - Serves local MLX embeddings through `/health` and OpenAI-compatible `/v1/embeddings`.
- Extend: `src/gbrainV5Runtime.ts`
  - Adds repo-local venv setup and deterministic LaunchAgent generation/control for the Jina v5 service.
- Create: `docker-compose.gbrain-v5.yml`
  - Defines the independent local Postgres + pgvector container.
- Modify: `src/index.ts`
  - Adds `gbrain-v5-env`, `gbrain-v5-check`, `gbrain-v5-init`, `jina-v5-setup`, and `jina-v5-service` commands.
- Modify: `src/cliArgs.ts`
  - Adds a small parser for `--dry-run` on gbrain-v5 init.
- Modify: `package.json`
  - Adds scripts for the new runtime commands and MLX server.
- Modify: `.env.example`
  - Adds safe v5 runtime environment variables.
- Modify: `.gitignore`
  - Ensures `.devbrain-teaching/postgres-data/`, `.devbrain-teaching/models/`, and `.devbrain-teaching/gbrain-v5/` stay ignored.
- Modify: `README.md`
  - Documents the isolated v5 runtime setup and boundary.

## Task 1: Runtime Config And Command Construction

**Files:**
- Create: `src/gbrainV5Runtime.ts`
- Test: `tests/gbrainV5Runtime.test.ts`

- [ ] **Step 1: Write failing tests for runtime defaults and isolation**

Add `tests/gbrainV5Runtime.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  buildGbrainV5Env,
  buildGbrainV5BaseEnv,
  buildGbrainV5InitCommand,
  checkGbrainV5Readiness,
  defaultGbrainV5Runtime,
  describeGbrainV5Env,
  preflightGbrainV5Init,
  repoLocalGbrainHome,
  runGbrainV5Init,
} from "../src/gbrainV5Runtime.js";

describe("gbrain v5 runtime", () => {
  it("keeps the v5 runtime inside .devbrain-teaching", () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });

    expect(runtime.root).toBe(resolve("/repo/.devbrain-teaching"));
    expect(runtime.gbrainHome).toBe(resolve("/repo/.devbrain-teaching/gbrain-v5"));
    expect(runtime.configPath).toBe(resolve("/repo/.devbrain-teaching/gbrain-v5/.gbrain/config.json"));
    expect(runtime.modelDir).toBe(resolve("/repo/.devbrain-teaching/models/jina-v5-text-small-mlx"));
    expect(runtime.postgres.port).toBe(55433);
    expect(runtime.embedding.dimensions).toBe(1024);
  });

  it("builds a repo-local GBRAIN_HOME and never points at ~/.gbrain", () => {
    const home = repoLocalGbrainHome("/repo");

    expect(home).toBe(resolve("/repo/.devbrain-teaching/gbrain-v5"));
    expect(home.includes("/.gbrain")).toBe(false);
  });

  it("builds gbrain env for the v5 embedding endpoint", () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const env = buildGbrainV5Env(runtime, {
      postgresPassword: "secret",
      baseEnv: { PATH: "/bin", HOME: "/Users/frank" },
    });

    expect(env.GBRAIN_HOME).toBe(resolve("/repo/.devbrain-teaching/gbrain-v5"));
    expect(env.GBRAIN_DATABASE_URL).toBe("postgresql://gbrain_v5:secret@127.0.0.1:55433/devbrainteaching_gbrain_v5");
    expect(env.LITELLM_BASE_URL).toBe("http://127.0.0.1:8797/v1");
    expect(env.GBRAIN_EMBEDDING_MODEL).toBe("litellm:jina-embeddings-v5-text-small");
    expect(env.GBRAIN_EMBEDDING_DIMENSIONS).toBe("1024");
  });

  it("removes ambient database, embedding, and model routing settings before adding v5 values", () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const env = buildGbrainV5BaseEnv(runtime, {
      PATH: "/bin",
      DATABASE_URL: "postgresql://wrong",
      GBRAIN_DATABASE_URL: "postgresql://wrong",
      GBRAIN_HOME: "/Users/frank/.gbrain",
      LITELLM_BASE_URL: "http://wrong",
      GBRAIN_EMBEDDING_MODEL: "litellm:wrong",
      GBRAIN_EMBEDDING_DIMENSIONS: "1536",
      GBRAIN_EMBEDDING_MULTIMODAL: "true",
      GBRAIN_EMBEDDING_MULTIMODAL_MODEL: "litellm:wrong-multimodal",
      GBRAIN_EMBEDDING_IMAGE_OCR: "true",
      GBRAIN_EMBEDDING_IMAGE_OCR_MODEL: "litellm:wrong-ocr",
      GBRAIN_CHAT_MODEL: "wrong-chat",
      GBRAIN_CHAT_FALLBACK_CHAIN: "wrong-a,wrong-b",
      GBRAIN_EXPANSION_MODEL: "wrong-expansion",
      GBRAIN_REMOTE_CLIENT_SECRET: "secret",
    });

    expect(env.PATH).toBe("/bin");
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.GBRAIN_DATABASE_URL).toBeUndefined();
    expect(env.GBRAIN_EMBEDDING_MULTIMODAL).toBeUndefined();
    expect(env.GBRAIN_EMBEDDING_MULTIMODAL_MODEL).toBeUndefined();
    expect(env.GBRAIN_EMBEDDING_IMAGE_OCR).toBeUndefined();
    expect(env.GBRAIN_EMBEDDING_IMAGE_OCR_MODEL).toBeUndefined();
    expect(env.GBRAIN_CHAT_MODEL).toBeUndefined();
    expect(env.GBRAIN_CHAT_FALLBACK_CHAIN).toBeUndefined();
    expect(env.GBRAIN_EXPANSION_MODEL).toBeUndefined();
    expect(env.GBRAIN_REMOTE_CLIENT_SECRET).toBeUndefined();
    expect(env.GBRAIN_HOME).toBe(resolve("/repo/.devbrain-teaching/gbrain-v5"));
    expect(env.LITELLM_BASE_URL).toBe("http://127.0.0.1:8797/v1");
    expect(env.GBRAIN_EMBEDDING_MODEL).toBe("litellm:jina-embeddings-v5-text-small");
    expect(env.GBRAIN_EMBEDDING_DIMENSIONS).toBe("1024");
  });

  it("describes only whitelisted non-secret env diagnostics", () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const description = describeGbrainV5Env(runtime, {
      OPENAI_API_KEY: "sk-secret",
      ANTHROPIC_API_KEY: "anthropic-secret",
      RANDOM_TOKEN: "token-secret",
      PATH: "/bin",
      DATABASE_URL: "postgresql://wrong",
    });
    const serialized = JSON.stringify(description);

    expect(description.env).toEqual({
      GBRAIN_HOME: resolve("/repo/.devbrain-teaching/gbrain-v5"),
      LITELLM_BASE_URL: "http://127.0.0.1:8797/v1",
      GBRAIN_EMBEDDING_MODEL: "litellm:jina-embeddings-v5-text-small",
      GBRAIN_EMBEDDING_DIMENSIONS: "1024",
      JINA_V5_EMBEDDING_MODEL: "jina-embeddings-v5-text-small",
      JINA_V5_EMBEDDING_DIMENSIONS: "1024",
    });
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("anthropic-secret");
    expect(serialized).not.toContain("token-secret");
    expect(serialized).not.toContain("postgresql://wrong");
    expect(serialized).not.toContain("/bin");
  });

  it("builds a non-interactive gbrain init command with 1024 dimensions", () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const command = buildGbrainV5InitCommand(runtime, "secret");

    expect(command.args).toEqual([
      "init",
      "--non-interactive",
      "--url",
      "postgresql://gbrain_v5:secret@127.0.0.1:55433/devbrainteaching_gbrain_v5",
      "--embedding-model",
      "litellm:jina-embeddings-v5-text-small",
      "--embedding-dimensions",
      "1024",
    ]);
    expect(command.redactedArgs).toEqual([
      "init",
      "--non-interactive",
      "--url",
      "postgresql://gbrain_v5:***@127.0.0.1:55433/devbrainteaching_gbrain_v5",
      "--embedding-model",
      "litellm:jina-embeddings-v5-text-small",
      "--embedding-dimensions",
      "1024",
    ]);
    expect(command.env.GBRAIN_HOME).toBe(resolve("/repo/.devbrain-teaching/gbrain-v5"));
    expect(command.redactedEnv.GBRAIN_DATABASE_URL).toBe("postgresql://gbrain_v5:***@127.0.0.1:55433/devbrainteaching_gbrain_v5");
  });

  it("passes repo-local env into every gbrain readiness command", async () => {
    const seen: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    await checkGbrainV5Readiness({
      runtime: defaultGbrainV5Runtime({ cwd: "/repo" }),
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/v1/embeddings")) {
          return Response.json({
            data: [{ embedding: Array.from({ length: 1024 }, () => 0.1) }],
            usage: { prompt_tokens: 1, total_tokens: 1 },
          });
        }
        return Response.json({ ok: true, model: "jina-embeddings-v5-text-small", dimensions: 1024 });
      },
      runner: (command, args, env) => {
        seen.push({ command, args, env });
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "devbrainteaching-gbrain-v5-postgres 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 1, stdout: "", stderr: "unexpected" };
      },
      readConfigFile: () => JSON.stringify({
        engine: "postgres",
        embedding_model: "litellm:jina-embeddings-v5-text-small",
        embedding_dimensions: 1024,
      }),
    });

    const gbrainCalls = seen.filter((call) => call.command === "gbrain");
    expect(gbrainCalls).toHaveLength(1);
    expect(gbrainCalls.every((call) => call.env.GBRAIN_HOME === resolve("/repo/.devbrain-teaching/gbrain-v5"))).toBe(true);
    expect(gbrainCalls.map((call) => call.args.join(" "))).toEqual(["--version"]);
    expect(seen.some((call) => call.command === "gbrain" && call.args.join(" ") === "config show")).toBe(false);
  });

  it("does not require postgres password for readiness diagnostics", async () => {
    const report = await checkGbrainV5Readiness({
      runtime: defaultGbrainV5Runtime({ cwd: "/repo" }),
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/embeddings")) {
          return Response.json({ data: [{ embedding: Array.from({ length: 1024 }, () => 0.1) }] });
        }
        return Response.json({ ok: true, model: "jina-embeddings-v5-text-small", dimensions: 1024 });
      },
      runner: (command, args) => {
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "devbrainteaching-gbrain-v5-postgres 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 1, stdout: "", stderr: "unexpected" };
      },
      readConfigFile: () => JSON.stringify({
        engine: "postgres",
        embedding_model: "litellm:jina-embeddings-v5-text-small",
        embedding_dimensions: 1024,
      }),
    });

    expect(report.ready).toBe(true);
    expect(report.checks.some((check) => check.name === "postgres-password")).toBe(false);
  });

  it("blocks init preflight when embedding smoke returns the wrong dimension", async () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const report = await preflightGbrainV5Init({
      runtime,
      postgresPassword: "secret",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/embeddings")) {
          return Response.json({ data: [{ embedding: [0.1, 0.2] }] });
        }
        return Response.json({ ok: true, model: "jina-embeddings-v5-text-small", dimensions: 1024 });
      },
      runner: (command, args) => {
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "devbrainteaching-gbrain-v5-postgres 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks.some((check) => check.name === "embedding-smoke" && !check.ok)).toBe(true);
  });

  it("does not require gbrain config show during init preflight", async () => {
    const calls: string[] = [];
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const report = await preflightGbrainV5Init({
      runtime,
      postgresPassword: "secret",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/embeddings")) {
          return Response.json({ data: [{ embedding: Array.from({ length: 1024 }, () => 0.1) }] });
        }
        return Response.json({ ok: true, model: "jina-embeddings-v5-text-small", dimensions: 1024 });
      },
      runner: (command, args, env) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "devbrainteaching-gbrain-v5-postgres 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 1, stdout: "", stderr: "unexpected" };
      },
    });

    expect(report.ready).toBe(true);
    expect(calls).toContain("gbrain --version");
    expect(calls).not.toContain("gbrain config show");
  });

  it("does not execute gbrain init when preflight fails", async () => {
    const calls: string[] = [];
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });

    await expect(runGbrainV5Init({
      runtime,
      postgresPassword: "secret",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/embeddings")) {
          return Response.json({ data: [{ embedding: [0.1, 0.2] }] });
        }
        return Response.json({ ok: true, model: "jina-embeddings-v5-text-small", dimensions: 1024 });
      },
      runner: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "devbrainteaching-gbrain-v5-postgres 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "init") {
          throw new Error("init should not be called");
        }
        return { command: [command, ...args], exitCode: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow(/preflight failed/);

    expect(calls.some((call) => call.startsWith("gbrain init"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
bun test tests/gbrainV5Runtime.test.ts
```

Expected: FAIL because `src/gbrainV5Runtime.ts` does not exist.

- [ ] **Step 3: Implement runtime defaults and command construction**

Create `src/gbrainV5Runtime.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CommandResult } from "./gbrainClient.js";

export interface GbrainV5Runtime {
  cwd: string;
  root: string;
  gbrainHome: string;
  configPath: string;
  modelDir: string;
  postgres: {
    containerName: string;
    host: string;
    port: number;
    database: string;
    user: string;
  };
  embedding: {
    modelId: string;
    model: string;
    dimensions: number;
    host: string;
    port: number;
  };
}

export interface BuildEnvOptions {
  postgresPassword: string;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface GbrainV5Command {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  redactedArgs: string[];
  redactedEnv: NodeJS.ProcessEnv;
}

export interface GbrainV5EnvDescription {
  runtime: {
    cwd: string;
    root: string;
    gbrainHome: string;
    configPath: string;
    modelDir: string;
    postgres: Omit<GbrainV5Runtime["postgres"], "host" | "port"> & {
      host: string;
      port: number;
    };
    embedding: GbrainV5Runtime["embedding"];
  };
  env: {
    GBRAIN_HOME: string;
    LITELLM_BASE_URL: string;
    GBRAIN_EMBEDDING_MODEL: string;
    GBRAIN_EMBEDDING_DIMENSIONS: string;
    JINA_V5_EMBEDDING_MODEL: string;
    JINA_V5_EMBEDDING_DIMENSIONS: string;
  };
}

export type RuntimeRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => CommandResult;

export function repoLocalGbrainHome(cwd = process.cwd()): string {
  return resolve(cwd, ".devbrain-teaching/gbrain-v5");
}

export function defaultGbrainV5Runtime(options: { cwd?: string } = {}): GbrainV5Runtime {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(cwd, ".devbrain-teaching");

  return {
    cwd,
    root,
    gbrainHome: resolve(root, "gbrain-v5"),
    configPath: resolve(root, "gbrain-v5/.gbrain/config.json"),
    modelDir: resolve(root, "models/jina-v5-text-small-mlx"),
    postgres: {
      containerName: "devbrainteaching-gbrain-v5-postgres",
      host: "127.0.0.1",
      port: 55433,
      database: "devbrainteaching_gbrain_v5",
      user: "gbrain_v5",
    },
    embedding: {
      modelId: "jinaai/jina-embeddings-v5-text-small-mlx",
      model: "jina-embeddings-v5-text-small",
      dimensions: 1024,
      host: "127.0.0.1",
      port: 8797,
    },
  };
}

export function gbrainV5DatabaseUrl(runtime: GbrainV5Runtime, password: string): string {
  if (!password) throw new Error("Missing GBRAIN_V5_POSTGRES_PASSWORD.");
  const encoded = encodeURIComponent(password);
  return `postgresql://${runtime.postgres.user}:${encoded}@${runtime.postgres.host}:${runtime.postgres.port}/${runtime.postgres.database}`;
}

export function redactedGbrainV5DatabaseUrl(runtime: GbrainV5Runtime): string {
  return `postgresql://${runtime.postgres.user}:***@${runtime.postgres.host}:${runtime.postgres.port}/${runtime.postgres.database}`;
}

export function buildGbrainV5BaseEnv(runtime: GbrainV5Runtime, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(cleanEnv)) {
    if (
      key === "DATABASE_URL" ||
      key === "GBRAIN_DATABASE_URL" ||
      key === "GBRAIN_HOME" ||
      key === "LITELLM_BASE_URL" ||
      key === "GBRAIN_EXPANSION_MODEL" ||
      key === "GBRAIN_REMOTE_CLIENT_SECRET" ||
      key.startsWith("GBRAIN_EMBEDDING_") ||
      key.startsWith("GBRAIN_CHAT_")
    ) {
      delete cleanEnv[key];
    }
  }

  return {
    ...cleanEnv,
    GBRAIN_HOME: runtime.gbrainHome,
    LITELLM_BASE_URL: `http://${runtime.embedding.host}:${runtime.embedding.port}/v1`,
    GBRAIN_EMBEDDING_MODEL: `litellm:${runtime.embedding.model}`,
    GBRAIN_EMBEDDING_DIMENSIONS: String(runtime.embedding.dimensions),
    JINA_V5_EMBEDDING_MODEL: runtime.embedding.model,
    JINA_V5_EMBEDDING_DIMENSIONS: String(runtime.embedding.dimensions),
  };
}

export function describeGbrainV5Env(runtime: GbrainV5Runtime, baseEnv: NodeJS.ProcessEnv = process.env): GbrainV5EnvDescription {
  const env = buildGbrainV5BaseEnv(runtime, baseEnv);
  return {
    runtime: {
      cwd: runtime.cwd,
      root: runtime.root,
      gbrainHome: runtime.gbrainHome,
      configPath: runtime.configPath,
      modelDir: runtime.modelDir,
      postgres: { ...runtime.postgres },
      embedding: { ...runtime.embedding },
    },
    env: {
      GBRAIN_HOME: env.GBRAIN_HOME ?? "",
      LITELLM_BASE_URL: env.LITELLM_BASE_URL ?? "",
      GBRAIN_EMBEDDING_MODEL: env.GBRAIN_EMBEDDING_MODEL ?? "",
      GBRAIN_EMBEDDING_DIMENSIONS: env.GBRAIN_EMBEDDING_DIMENSIONS ?? "",
      JINA_V5_EMBEDDING_MODEL: env.JINA_V5_EMBEDDING_MODEL ?? "",
      JINA_V5_EMBEDDING_DIMENSIONS: env.JINA_V5_EMBEDDING_DIMENSIONS ?? "",
    },
  };
}

export function buildGbrainV5Env(runtime: GbrainV5Runtime, options: BuildEnvOptions): NodeJS.ProcessEnv {
  const databaseUrl = gbrainV5DatabaseUrl(runtime, options.postgresPassword);
  return {
    ...buildGbrainV5BaseEnv(runtime, options.baseEnv ?? process.env),
    GBRAIN_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
  };
}

export function redactGbrainV5Env(runtime: GbrainV5Runtime, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    GBRAIN_HOME: env.GBRAIN_HOME,
    LITELLM_BASE_URL: env.LITELLM_BASE_URL,
    GBRAIN_EMBEDDING_MODEL: env.GBRAIN_EMBEDDING_MODEL,
    GBRAIN_EMBEDDING_DIMENSIONS: env.GBRAIN_EMBEDDING_DIMENSIONS,
    JINA_V5_EMBEDDING_MODEL: env.JINA_V5_EMBEDDING_MODEL,
    JINA_V5_EMBEDDING_DIMENSIONS: env.JINA_V5_EMBEDDING_DIMENSIONS,
    GBRAIN_DATABASE_URL: redactedGbrainV5DatabaseUrl(runtime),
    DATABASE_URL: redactedGbrainV5DatabaseUrl(runtime),
  };
}

export function buildGbrainV5InitCommand(runtime: GbrainV5Runtime, postgresPassword: string): GbrainV5Command {
  const databaseUrl = gbrainV5DatabaseUrl(runtime, postgresPassword);
  const env = buildGbrainV5Env(runtime, { postgresPassword });
  return {
    command: process.env.GBRAIN_BIN ?? "gbrain",
    env,
    args: [
      "init",
      "--non-interactive",
      "--url",
      databaseUrl,
      "--embedding-model",
      `litellm:${runtime.embedding.model}`,
      "--embedding-dimensions",
      String(runtime.embedding.dimensions),
    ],
    redactedEnv: redactGbrainV5Env(runtime, env),
    redactedArgs: [
      "init",
      "--non-interactive",
      "--url",
      redactedGbrainV5DatabaseUrl(runtime),
      "--embedding-model",
      `litellm:${runtime.embedding.model}`,
      "--embedding-dimensions",
      String(runtime.embedding.dimensions),
    ],
  };
}

export function runGbrainV5Command(command: GbrainV5Command): CommandResult {
  return spawnRuntimeCommand(command.command, command.args, command.env);
}

export const spawnRuntimeCommand: RuntimeRunner = (command, args, env) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
  });

  return {
    command: [command, ...args],
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

export function assertRepoLocalRuntime(runtime: GbrainV5Runtime): void {
  const expectedPrefix = resolve(runtime.cwd, ".devbrain-teaching");
  if (!runtime.gbrainHome.startsWith(`${expectedPrefix}/`)) {
    throw new Error(`Refusing to use GBRAIN_HOME outside repo runtime root: ${runtime.gbrainHome}`);
  }
  if (runtime.embedding.dimensions !== 1024) {
    throw new Error(`Expected v5 embedding dimensions to be 1024, got ${runtime.embedding.dimensions}.`);
  }
}

export interface GbrainV5ReadinessReport {
  ready: boolean;
  runtime: GbrainV5Runtime;
  checks: Array<{ name: string; ok: boolean; message: string }>;
}

function dockerPortOwnedByExpectedContainer(output: string, runtime: GbrainV5Runtime): boolean {
  return output.split("\n").some((line) =>
    line.includes(runtime.postgres.containerName) &&
    line.includes(`${runtime.postgres.host}:${runtime.postgres.port}->5432/tcp`),
  );
}

export type ConfigFileReader = (path: string) => string | null;

function defaultReadConfigFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function checkRepoLocalConfigFile(runtime: GbrainV5Runtime, readConfigFile: ConfigFileReader): { ok: boolean; message: string } {
  const raw = readConfigFile(runtime.configPath);
  if (!raw) return { ok: false, message: `Missing config file: ${runtime.configPath}` };
  try {
    const config = JSON.parse(raw) as {
      engine?: unknown;
      embedding_model?: unknown;
      embedding_dimensions?: unknown;
    };
    const ok =
      config.engine === "postgres" &&
      config.embedding_model === `litellm:${runtime.embedding.model}` &&
      Number(config.embedding_dimensions) === runtime.embedding.dimensions;
    return {
      ok,
      message: ok
        ? `repo-local config is postgres + ${runtime.embedding.dimensions}d`
        : `config mismatch: ${JSON.stringify({
            engine: config.engine,
            embedding_model: config.embedding_model,
            embedding_dimensions: config.embedding_dimensions,
          })}`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function checkEmbeddingSmoke(runtime: GbrainV5Runtime, fetchImpl: typeof fetch): Promise<{ ok: boolean; message: string }> {
  const response = await fetchImpl(`http://${runtime.embedding.host}:${runtime.embedding.port}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: `litellm:${runtime.embedding.model}`, input: ["DevBrainTeaching v5 smoke"] }),
  });
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  const body = await response.json() as { data?: Array<{ embedding?: unknown[] }> };
  const length = body.data?.[0]?.embedding?.length ?? 0;
  return {
    ok: length === runtime.embedding.dimensions,
    message: `embedding dimensions ${length}`,
  };
}

async function checkGbrainV5PreInitPrerequisites(options: {
  runtime?: GbrainV5Runtime;
  postgresPassword?: string;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
} = {}): Promise<GbrainV5ReadinessReport> {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  const checks: GbrainV5ReadinessReport["checks"] = [];
  const runner = options.runner ?? spawnRuntimeCommand;
  const baseEnv = buildGbrainV5BaseEnv(runtime);

  try {
    assertRepoLocalRuntime(runtime);
    checks.push({ name: "repo-local-runtime", ok: true, message: runtime.gbrainHome });
  } catch (error) {
    checks.push({ name: "repo-local-runtime", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  checks.push({
    name: "postgres-password",
    ok: Boolean(options.postgresPassword ?? process.env.GBRAIN_V5_POSTGRES_PASSWORD),
    message: "GBRAIN_V5_POSTGRES_PASSWORD must be set for init.",
  });

  const dockerVersion = runner("docker", ["--version"], process.env);
  checks.push({
    name: "docker-callable",
    ok: dockerVersion.exitCode === 0,
    message: dockerVersion.stdout.trim() || dockerVersion.stderr.trim(),
  });

  const dockerPs = runner("docker", ["ps", "--format", "{{.Names}} {{.Ports}}"], process.env);
  const expectedContainerOwnsPort = dockerPs.exitCode === 0 && dockerPortOwnedByExpectedContainer(dockerPs.stdout, runtime);
  checks.push({
    name: "postgres-container-port",
    ok: expectedContainerOwnsPort,
    message: expectedContainerOwnsPort ? `${runtime.postgres.containerName} owns ${runtime.postgres.port}` : dockerPs.stdout.trim() || dockerPs.stderr.trim(),
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`http://${runtime.embedding.host}:${runtime.embedding.port}/health`);
    checks.push({ name: "embedding-health", ok: response.ok, message: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name: "embedding-health", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  try {
    const smoke = await checkEmbeddingSmoke(runtime, fetchImpl);
    checks.push({ name: "embedding-smoke", ok: smoke.ok, message: smoke.message });
  } catch (error) {
    checks.push({ name: "embedding-smoke", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  const version = runner(process.env.GBRAIN_BIN ?? "gbrain", ["--version"], baseEnv);
  checks.push({ name: "gbrain-version", ok: version.exitCode === 0, message: version.stdout.trim() || version.stderr.trim() });

  checks.push({
    name: "global-gbrain-avoided",
    ok: baseEnv.GBRAIN_HOME === runtime.gbrainHome && !runtime.gbrainHome.includes("/.gbrain"),
    message: `GBRAIN_HOME=${baseEnv.GBRAIN_HOME}`,
  });

  const ready = checks.every((check) => check.ok);
  return { ready, runtime, checks };
}

export async function checkGbrainV5Readiness(options: {
  runtime?: GbrainV5Runtime;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
  readConfigFile?: ConfigFileReader;
} = {}): Promise<GbrainV5ReadinessReport> {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  const checks: GbrainV5ReadinessReport["checks"] = [];
  const runner = options.runner ?? spawnRuntimeCommand;
  const baseEnv = buildGbrainV5BaseEnv(runtime);

  try {
    assertRepoLocalRuntime(runtime);
    checks.push({ name: "repo-local-runtime", ok: true, message: runtime.gbrainHome });
  } catch (error) {
    checks.push({ name: "repo-local-runtime", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  const dockerVersion = runner("docker", ["--version"], process.env);
  checks.push({
    name: "docker-callable",
    ok: dockerVersion.exitCode === 0,
    message: dockerVersion.stdout.trim() || dockerVersion.stderr.trim(),
  });

  const dockerPs = runner("docker", ["ps", "--format", "{{.Names}} {{.Ports}}"], process.env);
  const expectedContainerOwnsPort = dockerPs.exitCode === 0 && dockerPortOwnedByExpectedContainer(dockerPs.stdout, runtime);
  checks.push({
    name: "postgres-container-port",
    ok: expectedContainerOwnsPort,
    message: expectedContainerOwnsPort ? `${runtime.postgres.containerName} owns ${runtime.postgres.port}` : dockerPs.stdout.trim() || dockerPs.stderr.trim(),
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`http://${runtime.embedding.host}:${runtime.embedding.port}/health`);
    checks.push({ name: "embedding-health", ok: response.ok, message: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name: "embedding-health", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  try {
    const smoke = await checkEmbeddingSmoke(runtime, fetchImpl);
    checks.push({ name: "embedding-smoke", ok: smoke.ok, message: smoke.message });
  } catch (error) {
    checks.push({ name: "embedding-smoke", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  const version = runner(process.env.GBRAIN_BIN ?? "gbrain", ["--version"], baseEnv);
  checks.push({ name: "gbrain-version", ok: version.exitCode === 0, message: version.stdout.trim() || version.stderr.trim() });

  checks.push({
    name: "global-gbrain-avoided",
    ok: baseEnv.GBRAIN_HOME === runtime.gbrainHome && !runtime.gbrainHome.includes("/.gbrain"),
    message: `GBRAIN_HOME=${baseEnv.GBRAIN_HOME}`,
  });

  const config = checkRepoLocalConfigFile(runtime, options.readConfigFile ?? defaultReadConfigFile);
  checks.push({
    name: "repo-local-config-file",
    ok: config.ok,
    message: config.message,
  });

  const ready = checks.every((check) => check.ok);
  return { ready, runtime, checks };
}

export async function preflightGbrainV5Init(options: {
  runtime?: GbrainV5Runtime;
  postgresPassword?: string;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
} = {}): Promise<GbrainV5ReadinessReport> {
  return checkGbrainV5PreInitPrerequisites(options);
}

export async function runGbrainV5Init(options: {
  dryRun?: boolean;
  postgresPassword?: string;
  runtime?: GbrainV5Runtime;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
} = {}): Promise<CommandResult | GbrainV5Command> {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  assertRepoLocalRuntime(runtime);
  const password = options.postgresPassword ?? process.env.GBRAIN_V5_POSTGRES_PASSWORD;
  if (!password) throw new Error("Missing GBRAIN_V5_POSTGRES_PASSWORD.");
  const command = buildGbrainV5InitCommand(runtime, password);
  if (options.dryRun) return command;
  const preflight = await preflightGbrainV5Init({
    runtime,
    postgresPassword: password,
    runner: options.runner,
    fetchImpl: options.fetchImpl,
  });
  if (!preflight.ready) {
    throw new Error(`gbrain v5 init preflight failed: ${JSON.stringify(preflight.checks, null, 2)}`);
  }
  return (options.runner ?? spawnRuntimeCommand)(command.command, command.args, command.env);
}
```

- [ ] **Step 4: Run tests for Task 1**

Run:

```bash
bun test tests/gbrainV5Runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/gbrainV5Runtime.ts tests/gbrainV5Runtime.test.ts
git commit -m "feat: add gbrain v5 runtime config"
```

## Task 2: Docker Compose For Independent pgvector

**Files:**
- Create: `docker-compose.gbrain-v5.yml`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Add the independent pgvector Compose file**

Create `docker-compose.gbrain-v5.yml`:

```yaml
name: devbrainteaching-gbrain-v5

services:
  gbrain-v5-postgres:
    image: pgvector/pgvector:pg17
    container_name: devbrainteaching-gbrain-v5-postgres
    environment:
      POSTGRES_DB: devbrainteaching_gbrain_v5
      POSTGRES_USER: gbrain_v5
      POSTGRES_PASSWORD: ${GBRAIN_V5_POSTGRES_PASSWORD:?GBRAIN_V5_POSTGRES_PASSWORD is required}
    ports:
      - "127.0.0.1:55433:5432"
    volumes:
      - ./.devbrain-teaching/postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gbrain_v5 -d devbrainteaching_gbrain_v5"]
      interval: 5s
      timeout: 5s
      retries: 20
```

- [ ] **Step 2: Extend `.env.example` for the v5 runtime**

Append this block to `.env.example`:

```dotenv

# Repo-local gbrain v5 runtime. This is separate from the global ~/.gbrain
# runtime and from any other running pgvector containers.
GBRAIN_V5_POSTGRES_PASSWORD=
GBRAIN_V5_POSTGRES_HOST=127.0.0.1
GBRAIN_V5_POSTGRES_PORT=55433
GBRAIN_V5_POSTGRES_DB=devbrainteaching_gbrain_v5
GBRAIN_V5_POSTGRES_USER=gbrain_v5

JINA_V5_MODEL_ID=jinaai/jina-embeddings-v5-text-small-mlx
JINA_V5_EMBEDDING_MODEL=jina-embeddings-v5-text-small
JINA_V5_EMBEDDING_DIMENSIONS=1024
JINA_V5_TASK=retrieval
JINA_V5_DOCUMENT_TASK_TYPE=retrieval.passage
JINA_V5_QUERY_TASK_TYPE=retrieval.query
JINA_V5_PROXY_HOST=127.0.0.1
JINA_V5_PROXY_PORT=8797
```

- [ ] **Step 3: Ensure generated runtime paths stay ignored**

Add these lines to `.gitignore` if they are not already covered:

```gitignore
.devbrain-teaching/postgres-data/
.devbrain-teaching/models/
.devbrain-teaching/gbrain-v5/
```

- [ ] **Step 4: Verify Compose config**

Run:

```bash
GBRAIN_V5_POSTGRES_PASSWORD=local-dev-password docker compose -f docker-compose.gbrain-v5.yml config >/tmp/devbrainteaching-gbrain-v5-compose.txt
```

Expected: command exits 0 and `/tmp/devbrainteaching-gbrain-v5-compose.txt` contains `devbrainteaching-gbrain-v5-postgres` and `127.0.0.1:55433`.

- [ ] **Step 5: Verify ignore rules**

Run:

```bash
git check-ignore -q --no-index .devbrain-teaching/postgres-data/example
git check-ignore -q --no-index .devbrain-teaching/models/example
git check-ignore -q --no-index .devbrain-teaching/gbrain-v5/.gbrain/config.json
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add docker-compose.gbrain-v5.yml .env.example .gitignore
git commit -m "chore: add isolated gbrain v5 postgres runtime"
```

## Task 3: Local MLX Embedding Server

**Files:**
- Create: `scripts/jina_v5_mlx_server.py`
- Modify: `package.json`

- [ ] **Step 1: Add the MLX server script**

Create `scripts/jina_v5_mlx_server.py`:

```python
#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


MODEL_ID = os.environ.get("JINA_V5_MODEL_ID", "jinaai/jina-embeddings-v5-text-small-mlx")
MODEL_DIR = Path(os.environ.get("JINA_V5_MODEL_DIR", ".devbrain-teaching/models/jina-v5-text-small-mlx")).resolve()
MODEL_NAME = os.environ.get("JINA_V5_EMBEDDING_MODEL", "jina-embeddings-v5-text-small")
DIMENSIONS = int(os.environ.get("JINA_V5_EMBEDDING_DIMENSIONS", "1024"))
HOST = os.environ.get("JINA_V5_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("JINA_V5_PROXY_PORT", "8797"))
TASK = os.environ.get("JINA_V5_TASK", "retrieval")
DOCUMENT_TASK_TYPE = os.environ.get("JINA_V5_DOCUMENT_TASK_TYPE", "retrieval.passage")
QUERY_TASK_TYPE = os.environ.get("JINA_V5_QUERY_TASK_TYPE", "retrieval.query")

_MODEL: Any = None


def ensure_model() -> Any:
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    from huggingface_hub import snapshot_download

    if not MODEL_DIR.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        snapshot_download(MODEL_ID, local_dir=str(MODEL_DIR))

    sys.path.insert(0, str(MODEL_DIR))
    from utils import load_model

    _MODEL = load_model(str(MODEL_DIR))
    _MODEL.switch_task(TASK)
    return _MODEL


def normalize_input(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                out.append(item["text"])
            else:
                raise ValueError("Each embedding input must be a string or an object with a text field.")
        return out
    raise ValueError("Embedding input must be a string or array.")


def normalize_model_name(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return MODEL_NAME
    if ":" in value:
        return value.split(":", 1)[1]
    return value


def task_type_for_request(body: dict[str, Any]) -> str:
    raw = body.get("task_type")
    if isinstance(raw, str) and raw:
        return raw
    raw_prompt = body.get("prompt_name")
    if raw_prompt == "query":
        return QUERY_TASK_TYPE
    return DOCUMENT_TASK_TYPE


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in ("/health", "/v1/health"):
            self.send_json(404, {"error": "Not found"})
            return
        query = parse_qs(parsed.query)
        if query.get("load") == ["true"]:
            try:
                ensure_model()
            except Exception as exc:
                self.send_json(503, {
                    "ok": False,
                    "provider": "jina-v5-mlx",
                    "model": MODEL_NAME,
                    "dimensions": DIMENSIONS,
                    "error": str(exc),
                })
                return
        self.send_json(200, {
            "ok": True,
            "provider": "jina-v5-mlx",
            "model": MODEL_NAME,
            "model_id": MODEL_ID,
            "dimensions": DIMENSIONS,
            "model_dir": str(MODEL_DIR),
        })

    def do_POST(self) -> None:
        if self.path != "/v1/embeddings":
            self.send_json(404, {"error": "Not found. Use POST /v1/embeddings."})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            texts = normalize_input(body.get("input"))
            model_name = normalize_model_name(body.get("model"))
            if model_name != MODEL_NAME:
                raise ValueError(f"Unsupported model {model_name}; expected {MODEL_NAME}.")
            model = ensure_model()
            embeddings = model.encode(texts, task_type=task_type_for_request(body))
            data = []
            for index, embedding in enumerate(embeddings):
                values = embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)
                if len(values) != DIMENSIONS:
                    raise ValueError(f"Embedding dimension mismatch: got {len(values)}, expected {DIMENSIONS}.")
                data.append({"object": "embedding", "index": index, "embedding": values})
            self.send_json(200, {
                "object": "list",
                "data": data,
                "model": MODEL_NAME,
                "usage": {"prompt_tokens": 0, "total_tokens": 0},
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Jina v5 MLX embedding server listening on http://{HOST}:{PORT}/v1", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Add the package script**

Modify `package.json` scripts:

```json
"jina-v5-mlx-server": ".devbrain-teaching/venv/bin/python scripts/jina_v5_mlx_server.py",
"jina-v5-setup": "bun run src/index.ts jina-v5-setup",
"jina-v5-service": "bun run src/index.ts jina-v5-service"
```

- [ ] **Step 3: Verify Python dependency error is clear**

Run:

```bash
(bun run jina-v5-mlx-server > /tmp/devbrainteaching-jina-v5.log 2>&1 & echo $! > /tmp/devbrainteaching-jina-v5.pid)
sleep 2
curl -fsS http://127.0.0.1:8797/health
curl -sS http://127.0.0.1:8797/health?load=true || true
kill "$(cat /tmp/devbrainteaching-jina-v5.pid)"
```

Expected before installing Python packages: `/health` works without loading the model. `/health?load=true` either returns `ok: true` after loading the model or returns HTTP 503 with an error naming the missing Python package or model-loading failure. Do not install dependencies in this task unless the user explicitly approves environment setup.

- [ ] **Step 4: Commit Task 3**

```bash
git add scripts/jina_v5_mlx_server.py package.json
git commit -m "feat: add local jina v5 mlx embedding server"
```

## Task 4: CLI Commands For V5 Runtime

**Files:**
- Modify: `src/cliArgs.ts`
- Modify: `src/index.ts`
- Test: `tests/gbrainV5Runtime.test.ts`

- [ ] **Step 1: Write failing tests for init preflight and redacted dry-run output**

Append to `tests/gbrainV5Runtime.test.ts` using the existing import list from Task 1:

```ts
describe("gbrain v5 init", () => {
  it("returns a redacted dry-run command without executing preflight", async () => {
    const result = await runGbrainV5Init({
      dryRun: true,
      postgresPassword: "secret",
    });

    expect("redactedArgs" in result).toBe(true);
    if ("redactedArgs" in result) {
      expect(result.redactedArgs.join(" ")).toContain("postgresql://gbrain_v5:***@127.0.0.1:55433/devbrainteaching_gbrain_v5");
      expect(result.redactedArgs.join(" ")).not.toContain("secret");
      expect(result.redactedEnv.GBRAIN_DATABASE_URL).not.toContain("secret");
    }
  });
});
```

- [ ] **Step 2: Add dry-run parser**

Append to `src/cliArgs.ts`:

```ts
export interface GbrainV5InitCliArgs {
  dryRun: boolean;
}

export function parseGbrainV5InitArgs(args: string[]): GbrainV5InitCliArgs {
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown gbrain v5 init argument: ${arg}`);
  }
  return { dryRun };
}
```

- [ ] **Step 3: Wire CLI commands**

Modify `src/index.ts` imports:

```ts
import { parseCodexCollectArgs, parseGbrainV5InitArgs } from "./cliArgs.js";
import {
  checkGbrainV5Readiness,
  defaultGbrainV5Runtime,
  describeGbrainV5Env,
  runGbrainV5Init,
} from "./gbrainV5Runtime.js";
```

Add command branches before the final usage block:

```ts
} else if (command === "gbrain-v5-env") {
  const runtime = defaultGbrainV5Runtime();
  console.log(JSON.stringify(describeGbrainV5Env(runtime), null, 2));
} else if (command === "gbrain-v5-check") {
  try {
    const report = await checkGbrainV5Readiness();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "gbrain-v5-init") {
  try {
    const args = parseGbrainV5InitArgs(process.argv.slice(3));
    const result = await runGbrainV5Init({ dryRun: args.dryRun });
    if ("redactedArgs" in result) {
      console.log(JSON.stringify({
        command: result.command,
        args: result.redactedArgs,
        env: result.redactedEnv,
      }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    if ("exitCode" in result && result.exitCode !== 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
```

Add usage lines:

```ts
  console.log("  bun run gbrain-v5-env");
  console.log("  bun run gbrain-v5-check");
  console.log("  bun run gbrain-v5-init -- --dry-run");
```

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
"gbrain-v5-env": "bun run src/index.ts gbrain-v5-env",
"gbrain-v5-check": "bun run src/index.ts gbrain-v5-check",
"gbrain-v5-init": "bun run src/index.ts gbrain-v5-init"
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test tests/gbrainV5Runtime.test.ts tests/cliArgs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run dry-run command without password**

Run:

```bash
bun run gbrain-v5-init -- --dry-run
```

Expected: non-zero exit and message `Missing GBRAIN_V5_POSTGRES_PASSWORD.`

- [ ] **Step 7: Run dry-run command with password**

Run:

```bash
GBRAIN_V5_POSTGRES_PASSWORD=local-dev-password bun run gbrain-v5-init -- --dry-run
```

Expected: JSON output includes:

```json
{
  "command": "gbrain",
  "args": [
    "init",
    "--non-interactive",
    "--url",
    "postgresql://gbrain_v5:***@127.0.0.1:55433/devbrainteaching_gbrain_v5",
    "--embedding-model",
    "litellm:jina-embeddings-v5-text-small",
    "--embedding-dimensions",
    "1024"
  ]
}
```

Expected: output does not contain `local-dev-password`.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/cliArgs.ts src/index.ts src/gbrainV5Runtime.ts tests/gbrainV5Runtime.test.ts package.json
git commit -m "feat: add gbrain v5 runtime cli"
```

## Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README section**

Append this section to `README.md` after the Jina v4 section:

```md
## Repo-Local GBrain V5 Runtime

The v5 runtime is an isolated experiment surface. It does not use the global
`~/.gbrain` config and does not reuse other running pgvector containers.

Runtime state is generated under `.devbrain-teaching/`:

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
bun run jina-v5-mlx-server
```

Check readiness:

```bash
bun run gbrain-v5-env
bun run gbrain-v5-check
```

Initialize the repo-local gbrain config:

```bash
GBRAIN_V5_POSTGRES_PASSWORD=... bun run gbrain-v5-init -- --dry-run
GBRAIN_V5_POSTGRES_PASSWORD=... bun run gbrain-v5-init
```

The runtime uses `jina-embeddings-v5-text-small` at 1024 dimensions. Existing
1536-dimensional v4 brains must not be mixed with this runtime.
```

- [ ] **Step 2: Run all tests**

Run:

```bash
bun test
```

Expected: PASS.

- [ ] **Step 3: Verify Docker Compose config**

Run:

```bash
GBRAIN_V5_POSTGRES_PASSWORD=local-dev-password docker compose -f docker-compose.gbrain-v5.yml config >/tmp/devbrainteaching-gbrain-v5-compose.txt
rg "devbrainteaching-gbrain-v5-postgres|55433|pgvector/pgvector:pg17" /tmp/devbrainteaching-gbrain-v5-compose.txt
```

Expected: `rg` prints the container name, host port, and image.

- [ ] **Step 4: Verify no runtime files are tracked**

Run:

```bash
git status --short
git check-ignore -q --no-index .devbrain-teaching/postgres-data/example
git check-ignore -q --no-index .devbrain-teaching/models/example
git check-ignore -q --no-index .devbrain-teaching/gbrain-v5/.gbrain/config.json
```

Expected: only intentional source/docs changes appear in `git status`; ignore checks exit 0.

- [ ] **Step 5: Commit Task 5**

```bash
git add README.md
git commit -m "docs: document repo-local gbrain v5 runtime"
```

## Self-Review

- Spec coverage:
  - Isolation: Tasks 1, 2, and 4.
  - Independent Postgres + pgvector: Task 2.
  - MLX embedding endpoint: Task 3.
  - Repo-local `GBRAIN_HOME`: Tasks 1 and 4.
  - Readiness diagnostics: Task 4.
  - Documentation and operator commands: Task 5.
- Placeholder scan:
  - No task relies on unspecified code paths.
  - Deferred Jina capabilities are excluded by spec and not hidden as implementation work.
- Type consistency:
  - `GbrainV5Runtime`, `GbrainV5Command`, `GbrainV5ReadinessReport`, and parser names are introduced before use.
  - CLI command names match package scripts.
