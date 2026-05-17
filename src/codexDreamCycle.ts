import { join } from "node:path";

import { collectCodexSessions, type CollectCodexSessionsResult } from "./codexCollector.js";
import { checkGbrainDreamReadiness } from "./gbrainDreamCheck.js";
import { createGbrainClient, GbrainCommandError, type GbrainRunner } from "./gbrainClient.js";
import type { CommandResult } from "./gbrainClient.js";
import { writePrivateFileAtomic } from "./privateArtifacts.js";
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
    diagnostics?: { available?: boolean; selected_count?: number | null; note?: string };
    interpretation?: string;
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
    data.diagnostics ? `- JSON diagnostics available: ${data.diagnostics.available === true}` : null,
    data.diagnostics?.selected_count !== undefined ? `- Selected count: ${data.diagnostics.selected_count ?? "unknown"}` : null,
    data.diagnostics?.note ? `- Diagnostics note: ${data.diagnostics.note}` : null,
    data.interpretation ? `- Interpretation: ${data.interpretation}` : null,
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
  writePrivateFileAtomic(join(runDir, "codex-dream-cycle.json"), `${JSON.stringify(report, null, 2)}\n`);
  writePrivateFileAtomic(join(runDir, "codex-dream-cycle.md"), renderCycleMarkdown(report));
}

function dryRunNote(dryRun: boolean | undefined): string | null {
  return dryRun ? "gbrain dream --dry-run may still run the cheap verdict model; it is not zero LLM cost." : null;
}

function redactAndBoundText(value: string, maxChars = 4000): string {
  return boundText(redactText(value).text, maxChars).text;
}

function selectedCountFromJson(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout) as { transcripts_selected?: unknown; selected_count?: unknown };
    const value = typeof parsed.transcripts_selected === "number" ? parsed.transcripts_selected : parsed.selected_count;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function interpretDreamDryRun(
  engineeringLikelyReviewable: number,
  selectedCount: number | null,
): "collector material appears weak" | "gbrain verdict remains conservative" | "gbrain selected material" | "diagnostic unavailable" {
  if (selectedCount === null) return "diagnostic unavailable";
  if (selectedCount > 0) return "gbrain selected material";
  if (engineeringLikelyReviewable > 0) return "gbrain verdict remains conservative";
  return "collector material appears weak";
}

function isJsonUnsupported(error: GbrainCommandError): boolean {
  const text = `${error.result.stderr}\n${error.result.stdout}`;
  return (
    /\b(?:unknown|unrecognized|unsupported|invalid)\s+(?:flag|option|argument)?\s*:?[\s-]*(?:--json|json)\b/i.test(text) ||
    /\b(?:--json|json)\b.*\b(?:unknown|unrecognized|unsupported|invalid)\s+(?:flag|option|argument)?\b/i.test(text)
  );
}

export function runCodexDreamCycle(options: CodexDreamCycleOptions = {}): void {
  const collect = options.collect ?? (() => collectCodexSessions({ limit: options.limit, engineeringCorpusDir: options.corpusDir }));
  const result = collect();
  const readiness = checkGbrainDreamReadiness({ corpusDir: result.engineeringCorpusDir ?? result.corpusDir, brainDir: options.brainDir, runner: options.runner });
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
  const writeReport = options.writeReport ?? ((report) => writeDefaultCycleReport(result.runDir, report));
  let lastArgs = options.dryRun ? [...baseArgs, "--dry-run", "--json"] : baseArgs;

  try {
    let args = options.dryRun ? [...baseArgs, "--dry-run"] : baseArgs;
    let dreamResult: CommandResult;
    let diagnostics: { available: boolean; selected_count: number | null; note?: string; parse_error?: string } | undefined;
    if (options.dryRun) {
      const jsonArgs = [...baseArgs, "--dry-run", "--json"];
      try {
        lastArgs = jsonArgs;
        dreamResult = client.run(jsonArgs);
        const selectedCount = selectedCountFromJson(dreamResult.stdout);
        args = jsonArgs;
        diagnostics = selectedCount === null
          ? {
              available: false,
              selected_count: null,
              parse_error: redactAndBoundText("Unable to parse gbrain dry-run JSON diagnostics."),
            }
          : { available: true, selected_count: selectedCount };
      } catch (error) {
        if (!(error instanceof GbrainCommandError) || !isJsonUnsupported(error)) throw error;
        args = [...baseArgs, "--dry-run"];
        lastArgs = args;
        dreamResult = client.run(args);
        diagnostics = {
          available: false,
          selected_count: null,
          note: "JSON diagnostics were unavailable; fell back to plain gbrain dream --dry-run.",
        };
      }
    } else {
      lastArgs = args;
      dreamResult = client.run(args);
    }
    const selectedCount = diagnostics?.selected_count ?? null;
    writeReport({
      dry_run: options.dryRun === true,
      dry_run_note: dryRunNote(options.dryRun),
      collect: result,
      readiness,
      gbrain_args: args,
      gbrain_exit_code: dreamResult.exitCode,
      diagnostics,
      interpretation: options.dryRun ? interpretDreamDryRun(result.engineeringLikelyReviewable ?? 0, selectedCount) : undefined,
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
      gbrain_args: lastArgs,
      gbrain_exit_code: failureResult?.exitCode ?? null,
      stdout_preview: redactAndBoundText(failureResult?.stdout ?? ""),
      stderr_preview: redactAndBoundText(failureResult?.stderr ?? ""),
    });
    throw new Error(message);
  }
}
