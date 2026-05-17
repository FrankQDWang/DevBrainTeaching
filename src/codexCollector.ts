import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { parseLimit } from "./cliArgs.js";
import { codexSessionParserVersion, parseCodexSessionJsonl, type ParsedCodexSession } from "./codexSessionParser.js";
import { dreamRendererVersion, dreamTranscriptFilename } from "./codexDreamTranscriptWriter.js";
import {
  buildCodexEngineeringEpisode,
  codexEngineeringAdapterVersion,
  engineeringExperienceEpisodeVersion,
  type EngineeringEpisodeQuality,
} from "./engineeringExperienceEpisode.js";
import {
  engineeringEpisodeRendererVersion,
  renderEngineeringExperienceEpisode,
} from "./engineeringExperienceEpisodeWriter.js";
import {
  buildCodexExperienceEnvelope,
  codexSessionAdapterVersion,
  experienceEnvelopeVersion,
  type ExperienceEvidenceEnvelope,
  type ExperienceEnvelopeQuality,
} from "./experienceEnvelope.js";
import { renderExperienceEnvelope } from "./experienceEnvelopeWriter.js";
import { ensurePrivateDir, writePrivateFileAtomic } from "./privateArtifacts.js";
import { redactionVersion } from "./redaction.js";

export interface CollectCodexSessionsOptions {
  sessionsDir?: string;
  corpusDir?: string;
  engineeringCorpusDir?: string;
  rawEnvelopeDir?: string;
  statePath?: string;
  runRoot?: string;
  limit?: number;
  isPathIgnored?: (path: string) => boolean;
  now?: () => Date;
}

export interface CollectCodexSessionsResult {
  corpusDir: string;
  engineeringCorpusDir: string;
  rawEnvelopeDir: string;
  runDir: string;
  considered: number;
  written: number;
  unchanged: number;
  skipped: number;
  engineeringEpisodeFilesWritten: number;
  rawEnvelopeFilesWritten: number;
  engineeringEvidenceItems: number;
  engineeringLikelyReviewable: number;
  engineeringWithProblem: number;
  engineeringWithAction: number;
  engineeringWithResult: number;
  engineeringWithOutcome: number;
  engineeringRedacted: number;
  engineeringTruncated: number;
  engineeringMalformed: number;
  engineeringLowSignal: number;
}

interface CollectorState {
  schema_version: 1;
  parser_version: string;
  redaction_version: string;
  updated_at: string;
  counters: {
    considered: number;
    written: number;
    unchanged: number;
    skipped: number;
    malformed: number;
    redacted: number;
    truncated: number;
    envelope_evidence_items: number;
    envelope_with_goal: number;
    envelope_with_source_event: number;
    envelope_with_tool_call: number;
    envelope_with_tool_result: number;
    envelope_with_assistant_final: number;
    envelope_likely_dream_reviewable: number;
    envelope_redacted_count: number;
    envelope_truncated_count: number;
    envelope_malformed_count: number;
    envelope_low_signal_count: number;
    engineeringEpisodeFilesWritten: number;
    rawEnvelopeFilesWritten: number;
    engineeringEvidenceItems: number;
    engineeringLikelyReviewable: number;
    engineeringWithProblem: number;
    engineeringWithAction: number;
    engineeringWithResult: number;
    engineeringWithOutcome: number;
    engineeringRedacted: number;
    engineeringTruncated: number;
    engineeringMalformed: number;
    engineeringLowSignal: number;
  };
  sessions: Record<
    string,
    {
      session_id: string;
      source_path: string;
      source_sha256: string;
      started_at?: string;
      updated_at: string;
      transcript_path?: string;
      fingerprint?: string;
      raw_envelope?: {
        transcript_path: string;
        fingerprint: string;
      };
      engineering_episode?: {
        transcript_path: string;
        fingerprint: string;
      };
    }
  >;
}

type CollectorStateSession = CollectorState["sessions"][string];

function defaultIsPathIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--no-index", "--", path], {
    cwd: process.cwd(),
  });
  return result.status === 0;
}

function ensureIgnored(paths: string[], isPathIgnored: (path: string) => boolean): void {
  for (const path of paths) {
    if (!isPathIgnored(path)) {
      throw new Error(`Refusing to write private Codex session artifacts because ${path} is not ignored by git.`);
    }
  }
}

function collectJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function sessionTimestamp(path: string): number {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead).toString("utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parsed = JSON.parse(line) as { timestamp?: unknown; payload?: { timestamp?: unknown } };
      const timestamp = typeof parsed.payload?.timestamp === "string" ? parsed.payload.timestamp : parsed.timestamp;
      if (typeof timestamp === "string") {
        const value = Date.parse(timestamp);
        if (Number.isFinite(value)) return value;
      }
    }
  } catch {
    return Number.NaN;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return Number.NaN;
}

function latestSessionFiles(sessionsDir: string, limit: number): string[] {
  return collectJsonlFiles(sessionsDir)
    .map((path) => {
      const mtimeMs = statSync(path).mtimeMs;
      const timestamp = sessionTimestamp(path);
      return {
        path,
        sortTime: Number.isFinite(timestamp) ? timestamp : mtimeMs,
      };
    })
    .sort((a, b) => b.sortTime - a.sortTime || b.path.localeCompare(a.path))
    .slice(0, limit)
    .map((item) => item.path)
    .reverse();
}

function readState(path: string): CollectorState | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CollectorState;
  } catch {
    return undefined;
  }
}

function migrateLegacySessionState(session: CollectorStateSession): CollectorStateSession {
  const { transcript_path: transcriptPath, fingerprint, ...rest } = session;
  if (!transcriptPath || !fingerprint || rest.raw_envelope) return rest;
  return {
    ...rest,
    raw_envelope: {
      transcript_path: transcriptPath,
      fingerprint,
    },
  };
}

function migrateLegacyStateSessions(previous: CollectorState | undefined): CollectorState["sessions"] {
  const migrated: CollectorState["sessions"] = {};
  for (const [key, session] of Object.entries(previous?.sessions ?? {})) {
    migrated[key] = migrateLegacySessionState(session);
  }
  return migrated;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactFingerprint(parts: Record<string, string>): string {
  return sha256Hex(JSON.stringify(Object.keys(parts).sort().map((key) => [key, parts[key]])));
}

function rawEnvelopeFingerprint(session: ParsedCodexSession): string {
  return artifactFingerprint({
    source_sha256: session.sourceSha256,
    parser_version: codexSessionParserVersion,
    renderer_version: dreamRendererVersion,
    redaction_version: redactionVersion,
    adapter_version: codexSessionAdapterVersion,
    envelope_version: experienceEnvelopeVersion,
  });
}

function engineeringFingerprint(session: ParsedCodexSession): string {
  return artifactFingerprint({
    source_sha256: session.sourceSha256,
    parser_version: codexSessionParserVersion,
    renderer_version: engineeringEpisodeRendererVersion,
    redaction_version: redactionVersion,
    adapter_version: codexEngineeringAdapterVersion,
    episode_version: engineeringExperienceEpisodeVersion,
  });
}

function engineeringTranscriptFilename(session: ParsedCodexSession): string {
  return dreamTranscriptFilename(session).replace(/\.txt$/, ".engineering.txt");
}

function rawEnvelopeTranscriptFilename(session: ParsedCodexSession): string {
  return dreamTranscriptFilename(session).replace(/\.txt$/, ".envelope.txt");
}

function stateSessionKey(session: ParsedCodexSession): string {
  return `${session.sessionId}:${session.sourceSha256.slice(0, 12)}`;
}

function assertContained(parent: string, child: string): void {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(`${resolvedParent}${sep}`)) {
    throw new Error(`Refusing to write outside target directory: ${resolvedChild}`);
  }
}

function runId(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function renderReport(state: CollectorState): string {
  return [
    "# Codex Collect Report",
    "",
    `- Considered: ${state.counters.considered}`,
    `- Written: ${state.counters.written}`,
    `- Unchanged: ${state.counters.unchanged}`,
    `- Skipped: ${state.counters.skipped}`,
    `- Malformed lines dropped: ${state.counters.malformed}`,
    `- Secrets redacted: ${state.counters.redacted}`,
    `- Text fields truncated: ${state.counters.truncated}`,
    `- Envelope evidence items: ${state.counters.envelope_evidence_items}`,
    `- Envelope sessions with goal: ${state.counters.envelope_with_goal}`,
    `- Envelope sessions with source event: ${state.counters.envelope_with_source_event}`,
    `- Envelope sessions with tool call: ${state.counters.envelope_with_tool_call}`,
    `- Envelope sessions with tool result: ${state.counters.envelope_with_tool_result}`,
    `- Envelope sessions with assistant final: ${state.counters.envelope_with_assistant_final}`,
    `- Envelope likely dream-reviewable: ${state.counters.envelope_likely_dream_reviewable}`,
    `- Envelope redacted count: ${state.counters.envelope_redacted_count}`,
    `- Envelope truncated count: ${state.counters.envelope_truncated_count}`,
    `- Envelope malformed count: ${state.counters.envelope_malformed_count}`,
    `- Envelope low-signal count: ${state.counters.envelope_low_signal_count}`,
    `- Engineering episode files written: ${state.counters.engineeringEpisodeFilesWritten}`,
    `- Engineering sessions with problem: ${state.counters.engineeringWithProblem}`,
    `- Engineering sessions with action: ${state.counters.engineeringWithAction}`,
    `- Engineering sessions with result: ${state.counters.engineeringWithResult}`,
    `- Engineering sessions with outcome: ${state.counters.engineeringWithOutcome}`,
    `- Engineering likely reviewable: ${state.counters.engineeringLikelyReviewable}`,
    `- Engineering evidence items: ${state.counters.engineeringEvidenceItems}`,
    `- Engineering redacted count: ${state.counters.engineeringRedacted}`,
    `- Engineering truncated count: ${state.counters.engineeringTruncated}`,
    `- Engineering malformed count: ${state.counters.engineeringMalformed}`,
    `- Engineering low-signal count: ${state.counters.engineeringLowSignal}`,
    `- Raw envelope debug files written: ${state.counters.rawEnvelopeFilesWritten}`,
    "",
  ].join("\n");
}

export function collectCodexSessions(options: CollectCodexSessionsOptions = {}): CollectCodexSessionsResult {
  const limit = parseLimit(options.limit === undefined ? undefined : String(options.limit));
  const sessionsDir = resolve(options.sessionsDir ?? join(homedir(), ".codex/sessions"));
  const engineeringCorpusDir = resolve(options.engineeringCorpusDir ?? options.corpusDir ?? ".devbrain-teaching/dream-corpus/codex-engineering");
  const rawEnvelopeDir = resolve(options.rawEnvelopeDir ?? ".devbrain-teaching/debug/envelopes/codex-sessions");
  const corpusDir = engineeringCorpusDir;
  const statePath = resolve(options.statePath ?? ".devbrain-teaching/state/codex-sessions.json");
  const runRoot = resolve(options.runRoot ?? ".devbrain-teaching/runs");
  const now = options.now?.() ?? new Date();
  const runDir = join(runRoot, runId(now), "codex-collect");
  const isPathIgnored = options.isPathIgnored ?? defaultIsPathIgnored;

  const files = latestSessionFiles(sessionsDir, limit);
  if (files.length === 0) {
    throw new Error(`No Codex session files found in ${sessionsDir}.`);
  }

  ensureIgnored(
    [
      join(corpusDir, "example.txt"),
      join(engineeringCorpusDir, "example.engineering.txt"),
      join(rawEnvelopeDir, "example.envelope.txt"),
      statePath,
      join(runDir, "manifest.json"),
    ],
    isPathIgnored,
  );

  ensurePrivateDir(corpusDir);
  ensurePrivateDir(rawEnvelopeDir);
  ensurePrivateDir(dirname(statePath));
  ensurePrivateDir(runDir);

  const previous = readState(statePath);
  const sessions = migrateLegacyStateSessions(previous);
  const counters: CollectorState["counters"] = {
    considered: files.length,
    written: 0,
    unchanged: 0,
    skipped: 0,
    malformed: 0,
    redacted: 0,
    truncated: 0,
    envelope_evidence_items: 0,
    envelope_with_goal: 0,
    envelope_with_source_event: 0,
    envelope_with_tool_call: 0,
    envelope_with_tool_result: 0,
    envelope_with_assistant_final: 0,
    envelope_likely_dream_reviewable: 0,
    envelope_redacted_count: 0,
    envelope_truncated_count: 0,
    envelope_malformed_count: 0,
    envelope_low_signal_count: 0,
    engineeringEpisodeFilesWritten: 0,
    rawEnvelopeFilesWritten: 0,
    engineeringEvidenceItems: 0,
    engineeringLikelyReviewable: 0,
    engineeringWithProblem: 0,
    engineeringWithAction: 0,
    engineeringWithResult: 0,
    engineeringWithOutcome: 0,
    engineeringRedacted: 0,
    engineeringTruncated: 0,
    engineeringMalformed: 0,
    engineeringLowSignal: 0,
  };

  const parsedRecords: Array<{
    session: ParsedCodexSession;
    envelope: ExperienceEvidenceEnvelope;
    quality: ExperienceEnvelopeQuality;
    engineeringQuality: EngineeringEpisodeQuality;
    engineeringTranscriptPath: string;
    rawEnvelopeTranscriptPath: string;
    engineeringFingerprint: string;
    rawEnvelopeFingerprint: string;
  }> = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const session = parseCodexSessionJsonl({ sourcePath: file, content });
    const envelopeResult = buildCodexExperienceEnvelope(session);
    const engineeringResult = buildCodexEngineeringEpisode(session);
    const envelopeQuality = envelopeResult.quality;
    const engineeringQuality = engineeringResult.quality;
    counters.malformed += session.dropped.malformedLines;
    counters.redacted += session.dropped.secretsRedacted;
    counters.truncated += session.dropped.textFieldsTruncated;
    counters.envelope_evidence_items += envelopeQuality.evidence_count;
    if (envelopeQuality.has_goal) counters.envelope_with_goal += 1;
    if (envelopeQuality.has_source_event) counters.envelope_with_source_event += 1;
    if (envelopeQuality.has_tool_call) counters.envelope_with_tool_call += 1;
    if (envelopeQuality.has_tool_result) counters.envelope_with_tool_result += 1;
    if (envelopeQuality.has_assistant_final) counters.envelope_with_assistant_final += 1;
    if (envelopeQuality.likely_dream_reviewable) counters.envelope_likely_dream_reviewable += 1;
    counters.envelope_redacted_count += envelopeQuality.redacted_count;
    counters.envelope_truncated_count += envelopeQuality.truncated_count;
    counters.envelope_malformed_count += envelopeQuality.malformed_count;
    counters.envelope_low_signal_count += envelopeQuality.low_signal_count;
    counters.engineeringEvidenceItems += engineeringQuality.evidence_count;
    if (engineeringQuality.has_problem) counters.engineeringWithProblem += 1;
    if (engineeringQuality.has_action) counters.engineeringWithAction += 1;
    if (engineeringQuality.has_result) counters.engineeringWithResult += 1;
    if (engineeringQuality.has_outcome) counters.engineeringWithOutcome += 1;
    if (engineeringQuality.likely_engineering_reviewable) counters.engineeringLikelyReviewable += 1;
    counters.engineeringRedacted += engineeringQuality.redacted_count;
    counters.engineeringTruncated += engineeringQuality.truncated_count;
    counters.engineeringMalformed += engineeringQuality.malformed_count;
    counters.engineeringLowSignal += engineeringQuality.low_signal_count;
    const engineeringTranscriptPath = join(engineeringCorpusDir, engineeringTranscriptFilename(session));
    const rawEnvelopeTranscriptPath = join(rawEnvelopeDir, rawEnvelopeTranscriptFilename(session));
    assertContained(engineeringCorpusDir, engineeringTranscriptPath);
    assertContained(rawEnvelopeDir, rawEnvelopeTranscriptPath);
    const nextEngineeringFingerprint = engineeringFingerprint(session);
    const nextRawEnvelopeFingerprint = rawEnvelopeFingerprint(session);
    const sessionKey = stateSessionKey(session);
    const previousSession = previous?.sessions[sessionKey];
    if (previousSession?.engineering_episode?.fingerprint === nextEngineeringFingerprint && existsSync(engineeringTranscriptPath)) {
      counters.unchanged += 1;
    } else {
      writePrivateFileAtomic(engineeringTranscriptPath, renderEngineeringExperienceEpisode(engineeringResult.episode));
      counters.written += 1;
      counters.engineeringEpisodeFilesWritten += 1;
    }
    if (previousSession?.raw_envelope?.fingerprint === nextRawEnvelopeFingerprint && existsSync(rawEnvelopeTranscriptPath)) {
      counters.unchanged += 1;
    } else {
      writePrivateFileAtomic(rawEnvelopeTranscriptPath, renderExperienceEnvelope(envelopeResult.envelope));
      counters.written += 1;
      counters.rawEnvelopeFilesWritten += 1;
    }
    sessions[sessionKey] = {
      session_id: session.sessionId,
      source_path: file,
      source_sha256: session.sourceSha256,
      started_at: session.startedAt,
      updated_at: now.toISOString(),
      raw_envelope: {
        transcript_path: rawEnvelopeTranscriptPath,
        fingerprint: nextRawEnvelopeFingerprint,
      },
      engineering_episode: {
        transcript_path: engineeringTranscriptPath,
        fingerprint: nextEngineeringFingerprint,
      },
    };
    parsedRecords.push({
      session,
      envelope: envelopeResult.envelope,
      quality: envelopeQuality,
      engineeringQuality,
      engineeringTranscriptPath,
      rawEnvelopeTranscriptPath,
      engineeringFingerprint: nextEngineeringFingerprint,
      rawEnvelopeFingerprint: nextRawEnvelopeFingerprint,
    });
  }

  const state: CollectorState = {
    schema_version: 1,
    parser_version: codexSessionParserVersion,
    redaction_version: redactionVersion,
    updated_at: now.toISOString(),
    counters,
    sessions,
  };
  writePrivateFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const manifest = {
    schema_version: 1,
    generated_at: now.toISOString(),
    corpus_dir: corpusDir,
    engineering_corpus_dir: engineeringCorpusDir,
    raw_envelope_dir: rawEnvelopeDir,
    state_path: statePath,
    sessions: parsedRecords.map(({ session, quality, engineeringQuality, engineeringTranscriptPath, rawEnvelopeTranscriptPath, engineeringFingerprint, rawEnvelopeFingerprint }) => ({
      session_id: session.sessionId,
      source_path: session.sourcePath,
      transcript_path: engineeringTranscriptPath,
      source_sha256: session.sourceSha256,
      source_size_bytes: session.sourceSizeBytes,
      started_at: session.startedAt,
      dropped: session.dropped,
      envelope_quality: quality,
      engineering_episode: {
        episode_version: engineeringExperienceEpisodeVersion,
        source_adapter: codexEngineeringAdapterVersion,
        transcript_path: engineeringTranscriptPath,
        fingerprint: engineeringFingerprint,
      },
      engineering_episode_quality: engineeringQuality,
      raw_envelope: {
        transcript_path: rawEnvelopeTranscriptPath,
        fingerprint: rawEnvelopeFingerprint,
      },
    })),
    counters,
  };
  writePrivateFileAtomic(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writePrivateFileAtomic(join(runDir, "report.md"), renderReport(state));

  return {
    corpusDir,
    engineeringCorpusDir,
    rawEnvelopeDir,
    runDir,
    considered: counters.considered,
    written: counters.written,
    unchanged: counters.unchanged,
    skipped: counters.skipped,
    engineeringEpisodeFilesWritten: counters.engineeringEpisodeFilesWritten,
    rawEnvelopeFilesWritten: counters.rawEnvelopeFilesWritten,
    engineeringEvidenceItems: counters.engineeringEvidenceItems,
    engineeringLikelyReviewable: counters.engineeringLikelyReviewable,
    engineeringWithProblem: counters.engineeringWithProblem,
    engineeringWithAction: counters.engineeringWithAction,
    engineeringWithResult: counters.engineeringWithResult,
    engineeringWithOutcome: counters.engineeringWithOutcome,
    engineeringRedacted: counters.engineeringRedacted,
    engineeringTruncated: counters.engineeringTruncated,
    engineeringMalformed: counters.engineeringMalformed,
    engineeringLowSignal: counters.engineeringLowSignal,
  };
}
