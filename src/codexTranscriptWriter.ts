import { createHash } from "node:crypto";

import type { ParsedCodexSession } from "./codexSessionParser.js";

const maxTranscriptChars = 50_000;
const parserVersion = "codex-session-parser-v1";

function yamlString(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

function list(values: string[], fallback = "Not captured."): string {
  if (values.length === 0) return `- ${fallback}`;
  return values.map((value) => `- ${value.replace(/\n/g, "\n  ")}`).join("\n");
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? value;
}

function datePrefix(session: ParsedCodexSession): string {
  const raw = session.startedAt ? Date.parse(session.startedAt) : Number.NaN;
  if (Number.isFinite(raw)) return new Date(raw).toISOString().slice(0, 10);
  return "unknown-date";
}

function transcriptTitle(session: ParsedCodexSession): string {
  const goal = session.userGoals[0];
  return goal ? firstLine(goal).slice(0, 120) : session.sessionId;
}

export function safeSlug(value: string): string {
  const slug = value
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 120);
  return slug || "unknown-session";
}

export function transcriptFilename(session: ParsedCodexSession): string {
  return `${datePrefix(session)}-${safeSlug(session.sessionId)}.md`;
}

function matchingNotes(notes: string[], pattern: RegExp): string[] {
  return notes.filter((note) => pattern.test(note));
}

function failedResults(results: string[]): string[] {
  return results.filter((result) => /fail|error|exception|non-zero|exit code [1-9]/i.test(result));
}

function capTranscript(markdown: string): string {
  if (markdown.length <= maxTranscriptChars) return markdown;
  return `${markdown.slice(0, maxTranscriptChars)}\n\n[TRANSCRIPT_TRUNCATED]\n`;
}

export function renderCodexTranscript(session: ParsedCodexSession): string {
  const decisions = matchingNotes(session.assistantNotes, /decision|tradeoff|choose|because|决定|取舍/i);
  const errors = failedResults(session.commandResults);
  const lessons = matchingNotes([...session.assistantNotes, ...session.outcomes], /lesson|reuse|next time|以后|经验|复用/i);
  const verification = session.commands
    .filter((command) => /test|verify|doctor|smoke|lint|typecheck|build/i.test(command))
    .map((command) => `\`${command}\``);

  const markdown = `---
type: codex-session
schema_version: 1
source: codex-app
session_id: ${yamlString(session.sessionId)}
source_path: ${yamlString(session.sourcePath)}
source_sha256: ${yamlString(session.sourceSha256)}
source_size_bytes: ${session.sourceSizeBytes}
cwd: ${yamlString(session.cwd)}
started_at: ${yamlString(session.startedAt)}
model: ${yamlString(session.model)}
originator: ${yamlString(session.originator)}
parser_version: ${yamlString(parserVersion)}
tags: ["codex-session"]
---
# Codex Session: ${transcriptTitle(session)}

## User Goal
${list(session.userGoals)}

## Project Context
${list(session.projectContext)}

## Key Events
${list(session.keyEvents)}

## Decisions And Tradeoffs
${list(decisions)}

## Errors And Root Causes
${list(errors)}

## Verification
${list(verification)}

## Outcome
${list(session.outcomes)}

## Reusable Lessons
${list(lessons)}

## Commands
${list(session.commands.map((command) => `\`${command}\``))}

## Command Results
${list(session.commandResults)}

## Referenced Files
${list(session.filePaths)}

## Parser Notes
- Malformed JSONL lines dropped: ${session.dropped.malformedLines}
- Low-signal events dropped: ${session.dropped.lowSignalEvents}
- Text fields truncated: ${session.dropped.textFieldsTruncated}
- Secrets redacted: ${session.dropped.secretsRedacted}
`;

  return capTranscript(markdown);
}

export function renderCodexManifest(sessions: ParsedCodexSession[], generatedAt: string): string {
  return `${JSON.stringify(
    {
      schema_version: 1,
      generated_at: generatedAt,
      parser_version: parserVersion,
      sessions: sessions.map((session) => {
        const transcriptName = transcriptFilename(session);
        return {
          session_id: session.sessionId,
          source_path: session.sourcePath,
          transcript_path: `transcripts/${transcriptName}`,
          source_sha256: session.sourceSha256,
          source_size_bytes: session.sourceSizeBytes,
          transcript_sha256: createHash("sha256").update(renderCodexTranscript(session)).digest("hex"),
          started_at: session.startedAt,
          cwd: session.cwd,
          malformed_lines: session.dropped.malformedLines,
          low_signal_events: session.dropped.lowSignalEvents,
          text_fields_truncated: session.dropped.textFieldsTruncated,
          secrets_redacted: session.dropped.secretsRedacted,
        };
      }),
    },
    null,
    2,
  )}\n`;
}
