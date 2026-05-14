#!/usr/bin/env bun

import { isGbrainCallable, runGbrain } from "./gbrainClient.js";
import { parseCodexIngestArgs } from "./cliArgs.js";
import { runCodexGbrainIngest } from "./codexGbrainIngest.js";
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
  try {
    const args = parseCodexIngestArgs(process.argv.slice(3));
    const result = runCodexGbrainIngest({ limit: args.limit });
    console.log(`Codex sessions ingested: ${result.transcriptsWritten}`);
    console.log(`Source root: ${result.sourceRoot}`);
    console.log(`Run artifacts: ${result.runDir}`);
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
  console.log("  bun run codex-ingest -- --limit 20");
}
