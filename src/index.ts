#!/usr/bin/env bun

import { isGbrainCallable, runGbrain } from "./gbrainClient.js";

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
} else {
  console.log("Usage:");
  console.log("  bun run doctor");
  console.log("  bun run candidates");
}

