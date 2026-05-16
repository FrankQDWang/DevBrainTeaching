import type { ParsedCodexSession } from "./codexSessionParser.js";
import { boundText, redactLocalPaths } from "./redaction.js";

export const experienceEnvelopeVersion = "experience-evidence-envelope-v1";
export const codexSessionAdapterVersion = "codex-session-adapter-v1";

const maxEvidenceItems = 30;
const maxEvidenceTextChars = 1_000;
const maxHeaderTextChars = 1_000;

export type ExperienceSourceKind = string;

export type ExperienceEvidenceKind =
  | "source_event"
  | "tool_call"
  | "tool_result"
  | "assistant_commentary"
  | "assistant_final"
  | "referenced_file";

export interface ExperienceEvidenceItem {
  kind: ExperienceEvidenceKind;
  source_channel: string;
  text: string;
  ordinal: number;
  provenance: {
    source_kind: ExperienceSourceKind;
    source_id: string;
    source_sha256: string;
  };
}

export interface ExperienceEnvelopeQuality {
  has_goal: boolean;
  has_source_event: boolean;
  has_tool_call: boolean;
  has_tool_result: boolean;
  has_assistant_final: boolean;
  evidence_count: number;
  redacted_count: number;
  truncated_count: number;
  malformed_count: number;
  low_signal_count: number;
  likely_dream_reviewable: boolean;
  notes: string[];
}

export interface ExperienceEvidenceEnvelope {
  schema_version: 1;
  envelope_version: typeof experienceEnvelopeVersion;
  source_kind: ExperienceSourceKind;
  source_adapter: string;
  source_id: string;
  source_sha256: string;
  source_path_redacted: string;
  workspace_redacted?: string;
  started_at?: string;
  model?: string;
  goal: string[];
  context: string[];
  evidence: ExperienceEvidenceItem[];
  trust_boundary: string[];
}

export interface ExperienceEnvelopeBuildResult {
  envelope: ExperienceEvidenceEnvelope;
  quality: ExperienceEnvelopeQuality;
}

interface NormalizedText {
  text: string;
  redacted: number;
  truncated: boolean;
}

interface AdapterStats {
  redacted: number;
  truncated: number;
  omitted: number;
}

function normalizeText(value: string, maxChars: number): NormalizedText {
  const redacted = redactLocalPaths(value);
  const bounded = boundText(redacted.text.replace(/\n{3,}/g, "\n\n").trim(), maxChars);
  return { text: bounded.text, redacted: redacted.count, truncated: bounded.truncated };
}

function applyStats(stats: AdapterStats, normalized: NormalizedText): string {
  stats.redacted += normalized.redacted;
  if (normalized.truncated) stats.truncated += 1;
  return normalized.text;
}

function makeItem(
  session: ParsedCodexSession,
  kind: ExperienceEvidenceKind,
  sourceChannel: string,
  text: string,
  ordinal: number,
): { item: ExperienceEvidenceItem; redacted: number; truncated: boolean } {
  const normalized = normalizeText(text, maxEvidenceTextChars);
  return {
    item: {
      kind,
      source_channel: sourceChannel,
      text: normalized.text,
      ordinal,
      provenance: {
        source_kind: "codex-session",
        source_id: session.sessionId,
        source_sha256: session.sourceSha256,
      },
    },
    redacted: normalized.redacted,
    truncated: normalized.truncated,
  };
}

function pushItem(items: ExperienceEvidenceItem[], stats: AdapterStats, built: { item: ExperienceEvidenceItem; redacted: number; truncated: boolean }): void {
  if (!built.item.text) return;
  stats.redacted += built.redacted;
  if (built.truncated) stats.truncated += 1;
  if (items.length >= maxEvidenceItems) return;
  items.push(built.item);
}

function pushMany(
  session: ParsedCodexSession,
  items: ExperienceEvidenceItem[],
  stats: AdapterStats,
  kind: ExperienceEvidenceKind,
  sourceChannel: string,
  values: string[],
): void {
  for (const value of values) {
    if (items.length >= maxEvidenceItems) {
      stats.omitted += 1;
      continue;
    }
    pushItem(items, stats, makeItem(session, kind, sourceChannel, value, items.length + 1));
  }
}

function quality(session: ParsedCodexSession, evidence: ExperienceEvidenceItem[], stats: AdapterStats, hasGoal: boolean): ExperienceEnvelopeQuality {
  const has = (kind: ExperienceEvidenceKind): boolean => evidence.some((item) => item.kind === kind);
  const result: ExperienceEnvelopeQuality = {
    has_goal: hasGoal,
    has_source_event: has("source_event"),
    has_tool_call: has("tool_call"),
    has_tool_result: has("tool_result"),
    has_assistant_final: has("assistant_final"),
    evidence_count: evidence.length,
    redacted_count: session.dropped.secretsRedacted + stats.redacted,
    truncated_count: session.dropped.textFieldsTruncated + stats.truncated,
    malformed_count: session.dropped.malformedLines,
    low_signal_count: session.dropped.lowSignalEvents,
    likely_dream_reviewable: false,
    notes: [],
  };

  if (!result.has_goal) result.notes.push("Missing goal evidence.");
  if (!result.has_source_event && !result.has_tool_call) result.notes.push("Missing observed action evidence.");
  if (!result.has_tool_result) result.notes.push("Missing observed result evidence.");
  if (!result.has_assistant_final) result.notes.push("Missing assistant final output.");
  if (stats.omitted > 0) result.notes.push(`Omitted ${stats.omitted} evidence items after item-count bound.`);
  result.likely_dream_reviewable = result.has_goal && (result.has_source_event || result.has_tool_call) && (result.has_tool_result || result.has_assistant_final);
  if (result.likely_dream_reviewable) result.notes.push("Has enough observed structure for gbrain dream review.");
  return result;
}

export function buildCodexExperienceEnvelope(session: ParsedCodexSession): ExperienceEnvelopeBuildResult {
  const evidence: ExperienceEvidenceItem[] = [];
  const stats: AdapterStats = { redacted: 0, truncated: 0, omitted: 0 };

  pushMany(session, evidence, stats, "source_event", "keyEvents", session.keyEvents);
  pushMany(session, evidence, stats, "tool_call", "commands", session.commands);
  pushMany(session, evidence, stats, "tool_result", "commandResults", session.commandResults);
  pushMany(session, evidence, stats, "assistant_commentary", "assistantNotes", session.assistantNotes);
  pushMany(session, evidence, stats, "assistant_final", "outcomes", session.outcomes);
  pushMany(session, evidence, stats, "referenced_file", "filePaths", session.filePaths);

  const sourcePath = applyStats(stats, normalizeText(session.sourcePath, maxHeaderTextChars));
  const workspace = session.cwd ? applyStats(stats, normalizeText(session.cwd, maxHeaderTextChars)) : undefined;
  const goal = session.userGoals.map((value) => applyStats(stats, normalizeText(value, maxHeaderTextChars))).filter(Boolean);
  const context = session.projectContext.map((value) => applyStats(stats, normalizeText(value, maxHeaderTextChars))).filter(Boolean);
  const envelope: ExperienceEvidenceEnvelope = {
    schema_version: 1,
    envelope_version: experienceEnvelopeVersion,
    source_kind: "codex-session",
    source_adapter: codexSessionAdapterVersion,
    source_id: session.sessionId,
    source_sha256: session.sourceSha256,
    source_path_redacted: sourcePath,
    workspace_redacted: workspace,
    started_at: session.startedAt,
    model: session.model,
    goal,
    context,
    evidence,
    trust_boundary: [
      "This is raw evidence, not durable knowledge.",
      "GBrain decides what, if anything, should be synthesized.",
      "This envelope may contain failed attempts, stale assumptions, and partial command output.",
    ],
  };

  return { envelope, quality: quality(session, evidence, stats, goal.length > 0) };
}
