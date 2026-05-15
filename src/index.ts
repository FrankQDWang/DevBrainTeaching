#!/usr/bin/env bun

import { isGbrainCallable, runGbrain } from "./gbrainClient.js";
import { parseCodexCollectArgs } from "./cliArgs.js";
import { collectCodexSessions } from "./codexCollector.js";
import { runCodexDreamCycle } from "./codexDreamCycle.js";
import { checkGbrainDreamReadiness } from "./gbrainDreamCheck.js";
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
} else if (command === "codex-dream-cycle") {
  try {
    const args = parseCodexCollectArgs(process.argv.slice(3));
    const brainDir = args.brainDir ?? process.env.GBRAIN_DREAM_DIR;
    runCodexDreamCycle({ limit: args.limit, dryRun: args.dryRun, brainDir });
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
  console.log("  bun run codex-collect -- --limit 20");
  console.log("  bun run gbrain-dream-check");
  console.log("  bun run codex-dream-cycle -- --limit 20 --dry-run --brain-dir /path/to/brain");
}
