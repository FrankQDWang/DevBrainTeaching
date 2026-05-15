import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  buildGbrainV5BaseEnv,
  buildGbrainV5Env,
  buildGbrainV5InitCommand,
  checkGbrainV5Readiness,
  defaultGbrainV5Runtime,
  describeGbrainV5Env,
  jinaV5ServiceSpec,
  preflightGbrainV5Init,
  repoLocalGbrainHome,
  renderJinaV5LaunchAgentPlist,
  runJinaV5ServiceAction,
  runGbrainV5Init,
  setupJinaV5Venv,
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

  it("passes repo-local env into every gbrain readiness command and avoids config show", async () => {
    const seen: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    await checkGbrainV5Readiness({
      runtime: defaultGbrainV5Runtime({ cwd: "/repo" }),
      fetchImpl: async (url) => {
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
        if (command === "docker" && args[0] === "inspect") {
          return { command: [command, ...args], exitCode: 0, stdout: "healthy\n", stderr: "" };
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
        if (command === "docker" && args[0] === "inspect") {
          return { command: [command, ...args], exitCode: 0, stdout: "healthy\n", stderr: "" };
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
    const report = await preflightGbrainV5Init({
      runtime: defaultGbrainV5Runtime({ cwd: "/repo" }),
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
        if (command === "docker" && args[0] === "inspect") {
          return { command: [command, ...args], exitCode: 0, stdout: "healthy\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 1, stdout: "", stderr: "unexpected" };
      },
    });

    expect(report.ready).toBe(false);
    expect(report.checks.some((check) => check.name === "embedding-smoke" && !check.ok)).toBe(true);
  });

  it("does not require gbrain config show during init preflight", async () => {
    const calls: string[] = [];
    const report = await preflightGbrainV5Init({
      runtime: defaultGbrainV5Runtime({ cwd: "/repo" }),
      postgresPassword: "secret",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/v1/embeddings")) {
          return Response.json({ data: [{ embedding: Array.from({ length: 1024 }, () => 0.1) }] });
        }
        return Response.json({ ok: true, model: "jina-embeddings-v5-text-small", dimensions: 1024 });
      },
      runner: (command, args) => {
        calls.push([command, ...args].join(" "));
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "devbrainteaching-gbrain-v5-postgres 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "inspect") {
          return { command: [command, ...args], exitCode: 0, stdout: "healthy\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
        }
        return { command: [command, ...args], exitCode: 1, stdout: "", stderr: "unexpected" };
      },
    });

    expect(report.ready).toBe(true);
    expect(calls).not.toContain("gbrain config show");
  });

  it("does not execute gbrain init when preflight fails", async () => {
    const calls: string[] = [];

    await expect(runGbrainV5Init({
      runtime: defaultGbrainV5Runtime({ cwd: "/repo" }),
      postgresPassword: "secret",
      runner: (command, args) => {
        calls.push([command, ...args].join(" "));
        if (command === "docker" && args[0] === "--version") {
          return { command: [command, ...args], exitCode: 0, stdout: "Docker version 1\n", stderr: "" };
        }
        if (command === "docker" && args[0] === "ps") {
          return { command: [command, ...args], exitCode: 0, stdout: "wrong-container 127.0.0.1:55433->5432/tcp\n", stderr: "" };
        }
        if (command === "gbrain" && args[0] === "init") {
          throw new Error("init should not be called");
        }
        return { command: [command, ...args], exitCode: 0, stdout: "", stderr: "" };
      },
      fetchImpl: async () => Response.json({ ok: true }),
    })).rejects.toThrow(/preflight failed/);

    expect(calls.some((call) => call.startsWith("gbrain init"))).toBe(false);
  });

  it("builds a repo-local launch agent plist for the Jina v5 service", () => {
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });
    const spec = jinaV5ServiceSpec(runtime, 501);
    const plist = renderJinaV5LaunchAgentPlist(spec);

    expect(spec.serviceTarget).toBe("gui/501/com.devbrainteaching.jina-v5-mlx-server");
    expect(spec.pythonPath).toBe(resolve("/repo/.devbrain-teaching/venv/bin/python"));
    expect(spec.plistPath).toBe(resolve("/repo/.devbrain-teaching/state/com.devbrainteaching.jina-v5-mlx-server.plist"));
    expect(spec.installedPlistPath).toBe(resolve(process.env.HOME ?? "", "Library/LaunchAgents/com.devbrainteaching.jina-v5-mlx-server.plist"));
    expect(plist).toContain("<string>/repo/.devbrain-teaching/venv/bin/python</string>");
    expect(plist).toContain("<string>/repo/scripts/jina_v5_mlx_server.py</string>");
    expect(plist).toContain("<key>JINA_V5_EMBEDDING_DIMENSIONS</key>");
    expect(plist).toContain("<string>1024</string>");
    expect(plist).toContain("<string>/repo</string>");
  });

  it("sets up the repo-local Python environment without using system pip directly", () => {
    const calls: string[] = [];
    const runtime = defaultGbrainV5Runtime({ cwd: "/repo" });

    setupJinaV5Venv({
      runtime,
      runner: (command, args) => {
        calls.push([command, ...args].join(" "));
        return { command: [command, ...args], exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toEqual([
      `python3 -m venv ${resolve("/repo/.devbrain-teaching/venv")}`,
      `${resolve("/repo/.devbrain-teaching/venv/bin/python")} -m pip install --upgrade pip`,
      `${resolve("/repo/.devbrain-teaching/venv/bin/python")} -m pip install mlx tokenizers huggingface_hub`,
    ]);
  });

  it("manages the Jina v5 LaunchAgent through deterministic launchctl calls", () => {
    const calls: string[] = [];
    const cwd = mkdtempSync(resolve(tmpdir(), "devbrain-gbrain-v5-"));
    const homeDir = mkdtempSync(resolve(tmpdir(), "devbrain-gbrain-v5-home-"));
    const runtime = defaultGbrainV5Runtime({ cwd });

    try {
      runJinaV5ServiceAction({
        action: "install",
        runtime,
        uid: 501,
        homeDir,
        runner: (command, args) => {
          calls.push([command, ...args].join(" "));
          if (command === "launchctl" && args[0] === "print") {
            return { command: [command, ...args], exitCode: 0, stdout: "loaded", stderr: "" };
          }
          return { command: [command, ...args], exitCode: 0, stdout: "", stderr: "" };
        },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }

    expect(calls).toEqual([
      "launchctl print gui/501/com.devbrainteaching.jina-v5-mlx-server",
      "launchctl bootout gui/501/com.devbrainteaching.jina-v5-mlx-server",
      "sleep 1",
      `launchctl bootstrap gui/501 ${resolve(homeDir, "Library/LaunchAgents/com.devbrainteaching.jina-v5-mlx-server.plist")}`,
    ]);
  });

  it("uninstalls the persistent LaunchAgent copy while tolerating unloaded services", () => {
    const calls: string[] = [];
    const cwd = mkdtempSync(resolve(tmpdir(), "devbrain-gbrain-v5-"));
    const homeDir = mkdtempSync(resolve(tmpdir(), "devbrain-gbrain-v5-home-"));
    const runtime = defaultGbrainV5Runtime({ cwd });

    try {
      runJinaV5ServiceAction({
        action: "uninstall",
        runtime,
        uid: 501,
        homeDir,
        runner: (command, args) => {
          calls.push([command, ...args].join(" "));
          return { command: [command, ...args], exitCode: 3, stdout: "", stderr: "not loaded" };
        },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }

    expect(calls).toEqual([
      "launchctl bootout gui/501/com.devbrainteaching.jina-v5-mlx-server",
    ]);
  });

  it("does not create a persistent LaunchAgent copy when stopping the service", () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "devbrain-gbrain-v5-"));
    const homeDir = mkdtempSync(resolve(tmpdir(), "devbrain-gbrain-v5-home-"));
    const runtime = defaultGbrainV5Runtime({ cwd });
    const installedPath = resolve(homeDir, "Library/LaunchAgents/com.devbrainteaching.jina-v5-mlx-server.plist");

    try {
      runJinaV5ServiceAction({
        action: "stop",
        runtime,
        uid: 501,
        homeDir,
        runner: (command, args) => ({ command: [command, ...args], exitCode: 0, stdout: "", stderr: "" }),
      });

      expect(existsSync(installedPath)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
