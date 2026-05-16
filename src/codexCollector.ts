import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import { parseLimit } from "./cliArgs.js";
import { codexSessionParserVersion, parseCodexSessionJsonl, type ParsedCodexSession } from "./codexSessionParser.js";
import { dreamRendererVersion, dreamTranscriptFilename } from "./codexDreamTranscriptWriter.js";
import {
  buildCodexExperienceEnvelope,
  codexSessionAdapterVersion,
  experienceEnvelopeVersion,
  type ExperienceEvidenceEnvelope,
  type ExperienceEnvelopeQuality,
} from "./experienceEnvelope.js";
import { renderExperienceEnvelope } from "./experienceEnvelopeWriter.js";
import { redactionVersion } from "./redaction.js";

export interface CollectCodexSessionsOptions {
  sessionsDir?: string;
  corpusDir?: string;
  statePath?: string;
  runRoot?: string;
  limit?: number;
  isPathIgnored?: (path: string) => boolean;
  now?: () => Date;
}

export interface CollectCodexSessionsResult {
  corpusDir: string;
  runDir: string;
  considered: number;
  written: number;
  unchanged: number;
  skipped: number;
}

interface CollectorState {
  schema_version: 1;
  parser_version: string;
  renderer_version: string;
  redaction_version: string;
  envelope_version: string;
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
  };
  sessions: Record<
    string,
    {
      session_id: string;
      source_path: string;
      transcript_path: string;
      source_sha256: string;
      fingerprint: string;
      started_at?: string;
      updated_at: string;
    }
  >;
}

function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Some filesystems ignore chmod; tests run where chmod is supported.
  }
}

function writePrivateFileAtomic(path: string, content: string): void {
  ensurePrivateDir(dirname(path));
  const tmpPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmpPath, content, { mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // Best effort on platforms without POSIX chmod support.
  }
  renameSync(tmpPath, path);
}

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

function fingerprint(session: ParsedCodexSession): string {
  return [
    session.sourceSha256,
    codexSessionParserVersion,
    dreamRendererVersion,
    redactionVersion,
    codexSessionAdapterVersion,
    experienceEnvelopeVersion,
  ].join(":");
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
    "",
  ].join("\n");
}

export function collectCodexSessions(options: CollectCodexSessionsOptions = {}): CollectCodexSessionsResult {
  const limit = parseLimit(options.limit === undefined ? undefined : String(options.limit));
  const sessionsDir = resolve(options.sessionsDir ?? join(homedir(), ".codex/sessions"));
  const corpusDir = resolve(options.corpusDir ?? ".devbrain-teaching/dream-corpus/codex-sessions");
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
      statePath,
      join(runDir, "manifest.json"),
    ],
    isPathIgnored,
  );

  ensurePrivateDir(corpusDir);
  ensurePrivateDir(dirname(statePath));
  ensurePrivateDir(runDir);

  const previous = readState(statePath);
  const sessions = { ...(previous?.sessions ?? {}) };
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
  };

  const parsedRecords: Array<{
    session: ParsedCodexSession;
    envelope: ExperienceEvidenceEnvelope;
    quality: ExperienceEnvelopeQuality;
  }> = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const session = parseCodexSessionJsonl({ sourcePath: file, content });
    const envelopeResult = buildCodexExperienceEnvelope(session);
    const envelopeQuality = envelopeResult.quality;
    parsedRecords.push({ session, envelope: envelopeResult.envelope, quality: envelopeQuality });
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
    const name = dreamTranscriptFilename(session);
    const outPath = join(corpusDir, name);
    assertContained(corpusDir, outPath);
    const nextFingerprint = fingerprint(session);
    const sessionKey = stateSessionKey(session);
    const previousSession = previous?.sessions[sessionKey];
    if (previousSession?.fingerprint === nextFingerprint && existsSync(outPath)) {
      counters.unchanged += 1;
    } else {
      writePrivateFileAtomic(outPath, renderExperienceEnvelope(envelopeResult.envelope));
      counters.written += 1;
    }
    sessions[sessionKey] = {
      session_id: session.sessionId,
      source_path: file,
      transcript_path: outPath,
      source_sha256: session.sourceSha256,
      fingerprint: nextFingerprint,
      started_at: session.startedAt,
      updated_at: now.toISOString(),
    };
  }

  const state: CollectorState = {
    schema_version: 1,
    parser_version: codexSessionParserVersion,
    renderer_version: dreamRendererVersion,
    redaction_version: redactionVersion,
    envelope_version: experienceEnvelopeVersion,
    updated_at: now.toISOString(),
    counters,
    sessions,
  };
  writePrivateFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const manifest = {
    schema_version: 1,
    generated_at: now.toISOString(),
    corpus_dir: corpusDir,
    state_path: statePath,
    sessions: parsedRecords.map(({ session, quality }) => ({
      session_id: session.sessionId,
      source_path: session.sourcePath,
      transcript_path: join(corpusDir, dreamTranscriptFilename(session)),
      source_sha256: session.sourceSha256,
      source_size_bytes: session.sourceSizeBytes,
      started_at: session.startedAt,
      dropped: session.dropped,
      envelope_quality: quality,
    })),
    counters,
  };
  writePrivateFileAtomic(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writePrivateFileAtomic(join(runDir, "report.md"), renderReport(state));

  return {
    corpusDir,
    runDir,
    considered: counters.considered,
    written: counters.written,
    unchanged: counters.unchanged,
    skipped: counters.skipped,
  };
}
