import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { createGbrainClient, runGbrain, type GbrainRunner } from "./gbrainClient.js";

export interface GbrainDreamCheckOptions {
  corpusDir?: string;
  brainDir?: string;
  runner?: GbrainRunner;
}

export interface GbrainDreamReadinessReport {
  ready: boolean;
  version: string | null;
  corpus_dir: string;
  brain_dir: string | null;
  brain_dir_ready: boolean;
  brain_dir_exists: boolean | null;
  brain_dir_is_directory: boolean | null;
  corpus_dir_exists: boolean;
  config: {
    embedding_model: string | null;
    embedding_dimensions: string | null;
    dream_synthesize_session_corpus_dir: string | null;
    dream_synthesize_enabled: string | null;
    models_dream_synthesize: string | null;
    models_dream_synthesize_verdict: string | null;
    models_tier_utility: string | null;
    models_tier_reasoning: string | null;
    models_tier_subagent: string | null;
    models_default: string | null;
    sync_repo_path: string | null;
  };
  missing_config: string[];
  mismatched_config: Array<{ key: string; expected: string; actual: string | null }>;
  warnings: string[];
  stale_sources: Array<{ id?: string; local_path?: string | null; federated?: boolean }>;
  command_errors: Array<{ stage: string; message: string }>;
  setup_commands: string[];
}

function parseConfigShowValue(output: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, "m");
  return pattern.exec(output)?.[1]?.trim() ?? null;
}

export function checkGbrainDreamReadiness(options: GbrainDreamCheckOptions = {}): GbrainDreamReadinessReport {
  const corpusDir = resolve(options.corpusDir ?? ".devbrain-teaching/dream-corpus/codex-sessions");
  const brainDir = options.brainDir ? resolve(options.brainDir) : null;
  const brainDirExists = brainDir ? existsSync(brainDir) : null;
  const brainDirIsDirectory = brainDir && brainDirExists ? statSync(brainDir).isDirectory() : brainDirExists === null ? null : false;
  const brainDirReady = brainDir !== null && brainDirExists === true && brainDirIsDirectory === true;
  const nonThrowingRunner = options.runner ?? runGbrain;
  const client = createGbrainClient(options.runner);
  const missing_config: string[] = [];
  const mismatched_config: GbrainDreamReadinessReport["mismatched_config"] = [];
  const warnings: string[] = [];
  const command_errors: GbrainDreamReadinessReport["command_errors"] = [];

  function runRequired(stage: string, args: string[]): string | null {
    try {
      const result = options.runner ? options.runner(args) : client.run(args);
      if (result.exitCode !== 0) {
        command_errors.push({ stage, message: result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}` });
        return null;
      }
      return result.stdout.trim();
    } catch (error) {
      command_errors.push({ stage, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  function getConfig(key: string): string | null {
    try {
      const result = nonThrowingRunner(["config", "get", key]);
      if (result.exitCode !== 0) {
        const message = `${result.stderr}\n${result.stdout}`;
        if (/not found|missing|unset|unknown config/i.test(message)) return null;
        command_errors.push({ stage: `config-get:${key}`, message: result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}` });
        return null;
      }
      return result.stdout.trim() || null;
    } catch (error) {
      command_errors.push({ stage: `config-get:${key}`, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  const version = runRequired("version", ["--version"]);
  const configShow = runRequired("config-show", ["config", "show"]) ?? "";
  const synthDir = getConfig("dream.synthesize.session_corpus_dir");
  const enabled = getConfig("dream.synthesize.enabled");
  const config = {
    embedding_model: parseConfigShowValue(configShow, "embedding_model"),
    embedding_dimensions: parseConfigShowValue(configShow, "embedding_dimensions"),
    dream_synthesize_session_corpus_dir: synthDir,
    dream_synthesize_enabled: enabled,
    models_dream_synthesize: getConfig("models.dream.synthesize"),
    models_dream_synthesize_verdict: getConfig("models.dream.synthesize_verdict"),
    models_tier_utility: getConfig("models.tier.utility"),
    models_tier_reasoning: getConfig("models.tier.reasoning"),
    models_tier_subagent: getConfig("models.tier.subagent"),
    models_default: getConfig("models.default"),
    sync_repo_path: getConfig("sync.repo_path"),
  };

  if (!synthDir) missing_config.push("dream.synthesize.session_corpus_dir");
  if (synthDir && resolve(synthDir) !== corpusDir) {
    mismatched_config.push({ key: "dream.synthesize.session_corpus_dir", expected: corpusDir, actual: synthDir });
  }
  if (enabled !== "true") {
    if (!enabled) missing_config.push("dream.synthesize.enabled");
    else mismatched_config.push({ key: "dream.synthesize.enabled", expected: "true", actual: enabled });
  }
  const syncRepoPathReady = config.sync_repo_path !== null && existsSync(config.sync_repo_path) && statSync(config.sync_repo_path).isDirectory();
  if (!config.sync_repo_path) {
    warnings.push("sync.repo_path is not configured; pass --brain-dir to codex-dream-cycle or configure sync.repo_path before full dream runs.");
  } else if (!syncRepoPathReady) {
    warnings.push(`Configured sync.repo_path is not usable: ${config.sync_repo_path}`);
  }
  if (brainDir !== null && !brainDirReady) {
    warnings.push(`Explicit brain dir is not usable: ${brainDir}`);
  }
  if (!config.models_dream_synthesize && !config.models_tier_reasoning && !config.models_default) {
    warnings.push("No explicit strong synthesis model configured; gbrain will use its reasoning-tier fallback.");
  }
  if (!config.models_dream_synthesize_verdict && !config.models_tier_utility && !config.models_default) {
    warnings.push("No explicit verdict model configured; gbrain will use its utility-tier fallback.");
  }

  let stale_sources: GbrainDreamReadinessReport["stale_sources"] = [];
  const sourcesJson = runRequired("sources-list", ["sources", "list", "--json"]);
  if (sourcesJson) {
    try {
      const parsed = JSON.parse(sourcesJson) as { sources?: Array<{ id?: string; local_path?: string | null; federated?: boolean }> };
      stale_sources = (parsed.sources ?? []).filter((source) => source.id === "codex-sessions");
    } catch (error) {
      command_errors.push({ stage: "sources-list", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const setup_commands = [
    `gbrain config set dream.synthesize.session_corpus_dir ${JSON.stringify(corpusDir)}`,
    "gbrain config set dream.synthesize.enabled true",
  ];
  const hasBrainDir = brainDir !== null ? brainDirReady : syncRepoPathReady;

  return {
    ready: existsSync(corpusDir) && hasBrainDir && missing_config.length === 0 && mismatched_config.length === 0 && stale_sources.length === 0 && command_errors.length === 0,
    version,
    corpus_dir: corpusDir,
    brain_dir: brainDir,
    brain_dir_ready: hasBrainDir,
    brain_dir_exists: brainDirExists,
    brain_dir_is_directory: brainDirIsDirectory,
    corpus_dir_exists: existsSync(corpusDir),
    config,
    missing_config,
    mismatched_config,
    warnings,
    stale_sources,
    command_errors,
    setup_commands,
  };
}
