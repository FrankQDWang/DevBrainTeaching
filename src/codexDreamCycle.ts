import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { collectCodexSessions, type CollectCodexSessionsResult } from "./codexCollector.js";
import { checkGbrainDreamReadiness } from "./gbrainDreamCheck.js";
import { createGbrainClient, GbrainCommandError, type GbrainRunner } from "./gbrainClient.js";
import { boundText, redactText } from "./redaction.js";

export interface CodexDreamCycleOptions {
  limit?: number;
  dryRun?: boolean;
  corpusDir?: string;
  brainDir?: string;
  runner?: GbrainRunner;
  collect?: () => CollectCodexSessionsResult;
  writeReport?: (report: unknown) => void;
}

function renderCycleMarkdown(report: unknown): string {
  const data = report as {
    dry_run?: boolean;
    dry_run_note?: string | null;
    skipped_gbrain?: boolean;
    skip_reason?: string;
    collect?: Partial<CollectCodexSessionsResult>;
    readiness?: { ready?: boolean; warnings?: string[] };
    gbrain_args?: string[] | null;
    gbrain_exit_code?: number | null;
    stdout_preview?: string;
    stderr_preview?: string;
  };
  return [
    "# Codex Dream Cycle Report",
    "",
    `- Dry run: ${data.dry_run === true}`,
    data.dry_run_note ? `- Dry-run note: ${data.dry_run_note}` : null,
    data.skipped_gbrain ? `- Skipped gbrain: ${data.skip_reason ?? "unknown"}` : null,
    `- Considered: ${data.collect?.considered ?? 0}`,
    `- Written: ${data.collect?.written ?? 0}`,
    `- Unchanged: ${data.collect?.unchanged ?? 0}`,
    `- Skipped: ${data.collect?.skipped ?? 0}`,
    `- Readiness ready: ${data.readiness?.ready === true}`,
    `- Readiness warnings: ${(data.readiness?.warnings ?? []).join("; ") || "none"}`,
    `- GBrain args: ${data.gbrain_args?.join(" ") ?? "not invoked"}`,
    `- GBrain exit code: ${data.gbrain_exit_code ?? "not invoked"}`,
    "",
    "## Stdout Preview",
    "```text",
    data.stdout_preview ?? "",
    "```",
    "",
    "## Stderr Preview",
    "```text",
    data.stderr_preview ?? "",
    "```",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function writeDefaultCycleReport(runDir: string, report: unknown): void {
  writeFileSync(join(runDir, "codex-dream-cycle.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(runDir, "codex-dream-cycle.md"), renderCycleMarkdown(report), { mode: 0o600 });
}

function dryRunNote(dryRun: boolean | undefined): string | null {
  return dryRun ? "gbrain dream --dry-run may still run the cheap verdict model; it is not zero LLM cost." : null;
}

function redactAndBoundText(value: string, maxChars = 4000): string {
  return boundText(redactText(value).text, maxChars).text;
}

export function runCodexDreamCycle(options: CodexDreamCycleOptions = {}): void {
  const collect = options.collect ?? (() => collectCodexSessions({ limit: options.limit, corpusDir: options.corpusDir }));
  const result = collect();
  const readiness = checkGbrainDreamReadiness({ corpusDir: result.corpusDir, brainDir: options.brainDir, runner: options.runner });
  if (!options.dryRun && !readiness.ready) {
    throw new Error(`gbrain dream is not ready: ${JSON.stringify(readiness, null, 2)}`);
  }
  if (!readiness.brain_dir_ready) {
    const report = {
      dry_run: options.dryRun === true,
      dry_run_note: dryRunNote(options.dryRun),
      skipped_gbrain: true,
      skip_reason: "gbrain dream requires sync.repo_path or an explicit brain dir. Pass --brain-dir or set GBRAIN_DREAM_DIR.",
      collect: result,
      readiness,
      gbrain_args: null,
      gbrain_exit_code: null,
      stdout_preview: "",
      stderr_preview: "",
    };
    (options.writeReport ?? ((value) => writeDefaultCycleReport(result.runDir, value)))(report);
    return;
  }

  const client = createGbrainClient(options.runner);
  const baseArgs = options.brainDir ? ["dream", "--dir", options.brainDir] : ["dream"];
  const args = options.dryRun ? [...baseArgs, "--dry-run"] : baseArgs;
  const writeReport = options.writeReport ?? ((report) => writeDefaultCycleReport(result.runDir, report));

  try {
    const dreamResult = client.run(args);
    writeReport({
      dry_run: options.dryRun === true,
      dry_run_note: dryRunNote(options.dryRun),
      collect: result,
      readiness,
      gbrain_args: args,
      gbrain_exit_code: dreamResult.exitCode,
      stdout_preview: redactAndBoundText(dreamResult.stdout),
      stderr_preview: redactAndBoundText(dreamResult.stderr),
    });
  } catch (error) {
    const failureResult = error instanceof GbrainCommandError ? error.result : null;
    const message = redactAndBoundText(error instanceof Error ? error.message : String(error));
    writeReport({
      dry_run: options.dryRun === true,
      dry_run_note: dryRunNote(options.dryRun),
      status: "failed",
      error: message,
      collect: result,
      readiness,
      gbrain_args: args,
      gbrain_exit_code: failureResult?.exitCode ?? null,
      stdout_preview: redactAndBoundText(failureResult?.stdout ?? ""),
      stderr_preview: redactAndBoundText(failureResult?.stderr ?? ""),
    });
    throw new Error(message);
  }
}
