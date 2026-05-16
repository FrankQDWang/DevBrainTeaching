#!/usr/bin/env bun

import { isGbrainCallable, runGbrain } from "./gbrainClient.js";
import { parseCodexCollectArgs, parseGbrainV5InitArgs, parseJinaV5ServiceArgs } from "./cliArgs.js";
import { collectCodexSessions } from "./codexCollector.js";
import { runCodexDreamCycle } from "./codexDreamCycle.js";
import { checkGbrainDreamReadiness } from "./gbrainDreamCheck.js";
import {
  checkGbrainV5Readiness,
  createGbrainV5Runner,
  defaultGbrainV5Runtime,
  describeGbrainV5Env,
  jinaV5ServiceSpec,
  runJinaV5ServiceAction,
  runGbrainV5Init,
  setupJinaV5Venv,
  type GbrainV5Command,
} from "./gbrainV5Runtime.js";
import { runJinaSmoke, startJinaProxy } from "./jinaProxy.js";

const command = process.argv[2] ?? "help";

if (command === "doctor") {
  const version = runGbrain(["--version"]);
  if (version.exitCode !== 0) {
    console.error("gbrain CLI is not callable.");
    console.error(version.stderr.trim());
    process.exitCode = 1;
  } else {
    console.log(`gbrain callable: ${version.stdout.trim()}`);
  }
} else if (command === "candidates") {
  if (!isGbrainCallable()) {
    console.error("gbrain CLI is not callable; run from an environment where gbrain is on PATH.");
    process.exitCode = 1;
  } else {
    console.log("Candidate slice plan:");
    console.log("- read gbrain facts/takes/pages through CLI or MCP");
    console.log("- score only items with concrete event + decision + tradeoff + transferable principle");
    console.log("- write candidate review artifacts under .devbrain-teaching/runs/");
  }
} else if (command === "jina-proxy") {
  startJinaProxy();
} else if (command === "jina-smoke") {
  try {
    await runJinaSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "jina-v5-setup") {
  try {
    const results = setupJinaV5Venv();
    for (const result of results) {
      console.log(result.stdout.trim() || result.stderr.trim() || result.command.join(" "));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "jina-v5-service") {
  try {
    const args = parseJinaV5ServiceArgs(process.argv.slice(3));
    const results = runJinaV5ServiceAction({ action: args.action });
    const runtime = defaultGbrainV5Runtime();
    const spec = jinaV5ServiceSpec(runtime);
    console.log(`Jina v5 service action: ${args.action}`);
    console.log(`Repo LaunchAgent: ${spec.plistPath}`);
    console.log(`Installed LaunchAgent: ${spec.installedPlistPath}`);
    for (const result of results) {
      const output = result.stdout.trim() || result.stderr.trim();
      if (output) console.log(output);
      if (result.exitCode !== 0 && args.action !== "stop") {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "gbrain-v5-env") {
  const runtime = defaultGbrainV5Runtime();
  console.log(JSON.stringify(describeGbrainV5Env(runtime), null, 2));
} else if (command === "gbrain-v5-check") {
  try {
    const runtime = defaultGbrainV5Runtime();
    const report = await checkGbrainV5Readiness({ runtime });
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
    if (args.dryRun) {
      const dryRun = result as GbrainV5Command;
      console.log(JSON.stringify({
        command: dryRun.command,
        args: dryRun.redactedArgs,
        env: dryRun.redactedEnv,
      }, null, 2));
    } else if (result.exitCode !== 0) {
      console.error(result.stderr.trim() || result.stdout.trim());
      process.exitCode = 1;
    } else {
      console.log(result.stdout.trim());
      console.log(`Repo-local config: ${defaultGbrainV5Runtime().configPath}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "codex-ingest") {
  console.error("codex-ingest is deprecated. Use codex-collect to prepare gbrain dream transcript corpus.");
  process.exitCode = 1;
} else if (command === "codex-collect") {
  try {
    const args = parseCodexCollectArgs(process.argv.slice(3));
    const result = collectCodexSessions({ limit: args.limit });
    console.log(`Codex sessions considered: ${result.considered}`);
    console.log(`Transcripts written: ${result.written}`);
    console.log(`Corpus: ${result.corpusDir}`);
    console.log(`Run artifacts: ${result.runDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "gbrain-dream-check") {
  try {
    const args = parseCodexCollectArgs(process.argv.slice(3));
    const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
    console.log(JSON.stringify(checkGbrainDreamReadiness({ brainDir }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "gbrain-v5-dream-check") {
  try {
    const args = parseCodexCollectArgs(process.argv.slice(3));
    const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
    const runtime = defaultGbrainV5Runtime();
    const runner = createGbrainV5Runner({ runtime });
    console.log(JSON.stringify(checkGbrainDreamReadiness({ brainDir, runner }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "codex-dream-cycle") {
  try {
    const args = parseCodexCollectArgs(process.argv.slice(3));
    const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
    runCodexDreamCycle({ limit: args.limit, dryRun: args.dryRun, brainDir });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === "codex-v5-dream-cycle") {
  try {
    const args = parseCodexCollectArgs(process.argv.slice(3));
    const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
    const runtime = defaultGbrainV5Runtime();
    const runner = createGbrainV5Runner({ runtime });
    runCodexDreamCycle({ limit: args.limit, dryRun: args.dryRun, brainDir, runner });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  console.log("Usage:");
  console.log("  bun run doctor");
  console.log("  bun run candidates");
  console.log("  bun run jina-proxy");
  console.log("  bun run jina-smoke");
  console.log("  bun run jina-v5-mlx-server");
  console.log("  bun run jina-v5-setup");
  console.log("  bun run jina-v5-service -- install|uninstall|start|stop|restart|status");
  console.log("  bun run gbrain-v5-env");
  console.log("  bun run gbrain-v5-check");
  console.log("  bun run gbrain-v5-init -- --dry-run");
  console.log("  bun run codex-collect -- --limit 20");
  console.log("  bun run gbrain-dream-check");
  console.log("  bun run codex-dream-cycle -- --limit 20 --dry-run --brain-dir /path/to/brain");
  console.log("  bun run gbrain-v5-dream-check");
  console.log("  bun run codex-v5-dream-cycle -- --limit 20 --dry-run --brain-dir /path/to/brain");
}
