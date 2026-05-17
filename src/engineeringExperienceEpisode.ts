import type { ParsedCodexEvidenceEvent, ParsedCodexSession } from "./codexSessionParser.js";
import { redactAndBoundEngineeringText } from "./redaction.js";

export const engineeringExperienceEpisodeVersion = "engineering-experience-episode-v1";
export const codexEngineeringAdapterVersion = "codex-engineering-adapter-v1";

const maxHeaderTextChars = 1_000;
const maxItemTextChars = 1_000;
const maxObservedItems = 40;

export type EngineeringExperienceItemKind =
  | "goal"
  | "context"
  | "source_event"
  | "engineering_action"
  | "observed_result"
  | "assistant_observation"
  | "final_outcome"
  | "referenced_file";

export interface EngineeringExperienceItem {
  kind: EngineeringExperienceItemKind;
  source_channel: string;
  text: string;
  ordinal: number;
  provenance: {
    source_kind: "codex-session";
    source_id: string;
    source_sha256: string;
    source_event_ordinal?: number;
    source_timestamp?: string;
    raw_payload_type?: string;
    call_id?: string;
    tool_name?: string;
  };
}

export interface EngineeringExperienceEpisode {
  schema_version: 1;
  episode_version: typeof engineeringExperienceEpisodeVersion;
  source_kind: "codex-session";
  source_adapter: typeof codexEngineeringAdapterVersion;
  source_id: string;
  source_sha256: string;
  source_path_redacted: string;
  workspace_redacted?: string;
  started_at?: string;
  model?: string;
  problem_statement: string[];
  engineering_context: string[];
  observed_sequence: EngineeringExperienceItem[];
  trust_boundary: string[];
}

export interface EngineeringEpisodeQuality {
  has_problem: boolean;
  has_action: boolean;
  has_result: boolean;
  has_outcome: boolean;
  evidence_count: number;
  redacted_count: number;
  truncated_count: number;
  malformed_count: number;
  low_signal_count: number;
  likely_engineering_reviewable: boolean;
  notes: string[];
}

export interface EngineeringEpisodeBuildResult {
  episode: EngineeringExperienceEpisode;
  quality: EngineeringEpisodeQuality;
}

interface AdapterStats {
  redacted: number;
  truncated: number;
  omitted: number;
}

function normalize(value: string, maxChars: number, stats: AdapterStats): string {
  const result = redactAndBoundEngineeringText(value, maxChars);
  stats.redacted += result.redacted_count;
  stats.truncated += result.truncated_count;
  return result.text;
}

function provenance(session: ParsedCodexSession, event?: ParsedCodexEvidenceEvent): EngineeringExperienceItem["provenance"] {
  return {
    source_kind: "codex-session",
    source_id: session.sessionId,
    source_sha256: session.sourceSha256,
    ...(event ? { source_event_ordinal: event.ordinal } : {}),
    ...(event?.timestamp ? { source_timestamp: event.timestamp } : {}),
    ...(event?.raw_payload_type ? { raw_payload_type: event.raw_payload_type } : {}),
    ...(event?.call_id ? { call_id: event.call_id } : {}),
    ...(event?.tool_name ? { tool_name: event.tool_name } : {}),
  };
}

function makeItem(
  session: ParsedCodexSession,
  stats: AdapterStats,
  kind: EngineeringExperienceItemKind,
  sourceChannel: string,
  text: string,
  ordinal: number,
  event?: ParsedCodexEvidenceEvent,
): EngineeringExperienceItem | undefined {
  const normalized = normalize(text, maxItemTextChars, stats);
  if (!normalized) return undefined;
  return {
    kind,
    source_channel: sourceChannel,
    text: normalized,
    ordinal,
    provenance: provenance(session, event),
  };
}

function pushLegacy(
  session: ParsedCodexSession,
  stats: AdapterStats,
  items: EngineeringExperienceItem[],
  kind: EngineeringExperienceItemKind,
  sourceChannel: string,
  values: string[],
): void {
  for (const value of values) {
    if (items.length >= maxObservedItems) {
      stats.omitted += 1;
      continue;
    }
    const item = makeItem(session, stats, kind, sourceChannel, value, items.length + 1);
    if (item) items.push(item);
  }
}

function buildObservedSequence(session: ParsedCodexSession, stats: AdapterStats): EngineeringExperienceItem[] {
  const items: EngineeringExperienceItem[] = [];
  if (session.engineeringEvents.length > 0) {
    for (const event of session.engineeringEvents) {
      if (items.length >= maxObservedItems) {
        stats.omitted += 1;
        continue;
      }
      const item = makeItem(session, stats, event.kind, event.source_channel, event.text, items.length + 1, event);
      if (item) items.push(item);
    }
    return items;
  }

  pushLegacy(session, stats, items, "goal", "userGoals", session.userGoals);
  pushLegacy(session, stats, items, "context", "projectContext", session.projectContext);
  pushLegacy(session, stats, items, "source_event", "keyEvents", session.keyEvents);
  pushLegacy(session, stats, items, "engineering_action", "commands", session.commands);
  pushLegacy(session, stats, items, "observed_result", "commandResults", session.commandResults);
  pushLegacy(session, stats, items, "assistant_observation", "assistantNotes", session.assistantNotes);
  pushLegacy(session, stats, items, "final_outcome", "outcomes", session.outcomes);
  pushLegacy(session, stats, items, "referenced_file", "filePaths", session.filePaths);
  return items;
}

function buildQuality(session: ParsedCodexSession, observed: EngineeringExperienceItem[], stats: AdapterStats, hasProblem: boolean): EngineeringEpisodeQuality {
  const has = (kind: EngineeringExperienceItemKind): boolean => observed.some((item) => item.kind === kind);
  const quality: EngineeringEpisodeQuality = {
    has_problem: hasProblem,
    has_action: has("engineering_action"),
    has_result: has("observed_result"),
    has_outcome: has("final_outcome"),
    evidence_count: observed.length,
    redacted_count: session.dropped.secretsRedacted + stats.redacted,
    truncated_count: session.dropped.textFieldsTruncated + stats.truncated,
    malformed_count: session.dropped.malformedLines,
    low_signal_count: session.dropped.lowSignalEvents,
    likely_engineering_reviewable: false,
    notes: [],
  };
  if (!quality.has_problem) quality.notes.push("Missing problem evidence.");
  if (!quality.has_action) quality.notes.push("Missing engineering action evidence.");
  if (!quality.has_result && !quality.has_outcome) quality.notes.push("Missing observed result or final outcome evidence.");
  if (stats.omitted > 0) quality.notes.push(`Omitted ${stats.omitted} engineering evidence items after item-count bound.`);
  quality.likely_engineering_reviewable = quality.has_problem && quality.has_action && (quality.has_result || quality.has_outcome);
  return quality;
}

export function buildCodexEngineeringEpisode(session: ParsedCodexSession): EngineeringEpisodeBuildResult {
  const stats: AdapterStats = { redacted: 0, truncated: 0, omitted: 0 };
  const problemStatement = session.userGoals.map((value) => normalize(value, maxHeaderTextChars, stats)).filter(Boolean);
  const engineeringContext = session.projectContext.map((value) => normalize(value, maxHeaderTextChars, stats)).filter(Boolean);
  const observedSequence = buildObservedSequence(session, stats);
  const sourcePath = normalize(session.sourcePath, maxHeaderTextChars, stats);
  const workspace = session.cwd ? normalize(session.cwd, maxHeaderTextChars, stats) : undefined;
  const episode: EngineeringExperienceEpisode = {
    schema_version: 1,
    episode_version: engineeringExperienceEpisodeVersion,
    source_kind: "codex-session",
    source_adapter: codexEngineeringAdapterVersion,
    source_id: session.sessionId,
    source_sha256: session.sourceSha256,
    source_path_redacted: sourcePath,
    workspace_redacted: workspace,
    started_at: session.startedAt,
    model: session.model,
    problem_statement: problemStatement,
    engineering_context: engineeringContext,
    observed_sequence: observedSequence,
    trust_boundary: [
      "This is raw engineering evidence, not durable knowledge.",
      "GBrain decides what, if anything, should be synthesized.",
    ],
  };
  return { episode, quality: buildQuality(session, observedSequence, stats, problemStatement.length > 0) };
}
