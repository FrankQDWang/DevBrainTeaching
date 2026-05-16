import type { ParsedCodexSession } from "./codexSessionParser.js";
import { safeSlug } from "./codexTranscriptWriter.js";
import { buildCodexExperienceEnvelope } from "./experienceEnvelope.js";
import { renderExperienceEnvelope } from "./experienceEnvelopeWriter.js";

export const dreamRendererVersion = "codex-dream-transcript-renderer-v2";

function datePrefix(session: ParsedCodexSession): string {
  const parsed = session.startedAt ? Date.parse(session.startedAt) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "unknown-date";
}

export function dreamTranscriptFilename(session: ParsedCodexSession): string {
  return `${datePrefix(session)}-${safeSlug(session.sessionId)}-${session.sourceSha256.slice(0, 8)}.txt`;
}

export function renderDreamTranscript(session: ParsedCodexSession): string {
  return renderExperienceEnvelope(buildCodexExperienceEnvelope(session).envelope);
}
