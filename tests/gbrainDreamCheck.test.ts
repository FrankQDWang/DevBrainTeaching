import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkGbrainDreamReadiness } from "../src/gbrainDreamCheck.js";
import type { CommandResult, GbrainRunner } from "../src/gbrainClient.js";

function ok(args: string[], stdout = ""): CommandResult {
  return { command: ["gbrain", ...args], exitCode: 0, stdout, stderr: "" };
}

function fail(args: string[], stderr = "missing"): CommandResult {
  return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr };
}

describe("gbrain dream readiness", () => {
  it("reports missing dream config, model route, embedding config, and stale direct source", () => {
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "GBrain config:\n  embedding_model: litellm:jina-embeddings-v4\n  embedding_dimensions: 1536\n");
      if (args.join(" ") === "sources list --json") {
        return ok(args, JSON.stringify({ sources: [{ id: "codex-sessions", local_path: "/old", federated: false }] }));
      }
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const report = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", runner });
    expect(report.ready).toBe(false);
    expect(report.version).toBe("gbrain 0.33.1.0");
    expect(report.config.embedding_model).toBe("litellm:jina-embeddings-v4");
    expect(report.config.embedding_dimensions).toBe("1536");
    expect(report.corpus_dir_exists).toBe(false);
    expect(report.missing_config).toContain("dream.synthesize.session_corpus_dir");
    expect(report.command_errors.some((error) => error.stage.startsWith("config-get:"))).toBe(false);
    expect(report.warnings).toContain("sync.repo_path is not configured; pass --brain-dir to codex-dream-cycle or configure sync.repo_path before full dream runs.");
    expect(report.stale_sources).toHaveLength(1);
  });

  it("does not throw on malformed sources JSON", () => {
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "");
      if (args.join(" ") === "sources list --json") return ok(args, "not json");
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const report = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", runner });
    expect(report.ready).toBe(false);
    expect(report.command_errors.some((error) => error.stage === "sources-list")).toBe(true);
  });

  it("validates explicit brain directories", () => {
    const brainDir = join(tmpdir(), `gbrain-dream-check-${Date.now()}`);
    mkdirSync(brainDir, { recursive: true });
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "");
      if (args.join(" ") === "sources list --json") return ok(args, JSON.stringify({ sources: [] }));
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const existing = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", brainDir, runner });
    expect(existing.brain_dir_exists).toBe(true);
    expect(existing.brain_dir_is_directory).toBe(true);

    rmSync(brainDir, { recursive: true, force: true });
    const missing = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", brainDir, runner });
    expect(missing.brain_dir_exists).toBe(false);
    expect(missing.brain_dir_ready).toBe(false);
  });

  it("does not treat a missing sync.repo_path as a usable brain directory", () => {
    const missingPath = join(tmpdir(), `missing-gbrain-sync-${Date.now()}`);
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return ok(args, "gbrain 0.33.1.0\n");
      if (args.join(" ") === "config show") return ok(args, "");
      if (args.join(" ") === "sources list --json") return ok(args, JSON.stringify({ sources: [] }));
      if (args[0] === "config" && args[1] === "get" && args[2] === "sync.repo_path") {
        return ok(args, `${missingPath}\n`);
      }
      if (args[0] === "config" && args[1] === "get") return fail(args, "Config key not found");
      return ok(args);
    };

    const report = checkGbrainDreamReadiness({ corpusDir: "/new-corpus", runner });
    expect(report.brain_dir_ready).toBe(false);
    expect(report.warnings).toContain(`Configured sync.repo_path is not usable: ${missingPath}`);
  });
});
