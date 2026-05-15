import { createHash } from "node:crypto";

import { boundText, redactText } from "./redaction.js";

const maxTextFieldChars = 2_000;
const maxUserGoals = 6;
const maxAssistantNotes = 12;
const maxOutcomes = 6;
const maxCommandResults = 30;
const maxFilePaths = 80;
export const codexSessionParserVersion = "codex-session-parser-v1";

export interface ParseCodexSessionInput {
  sourcePath: string;
  content: string;
}

export interface CodexParserDropStats {
  malformedLines: number;
  lowSignalEvents: number;
  textFieldsTruncated: number;
  secretsRedacted: number;
}

export interface ParsedCodexSession {
  sourcePath: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  sessionId: string;
  cwd?: string;
  model?: string;
  originator?: string;
  startedAt?: string;
  userGoals: string[];
  projectContext: string[];
  keyEvents: string[];
  assistantNotes: string[];
  commands: string[];
  commandResults: string[];
  filePaths: string[];
  outcomes: string[];
  dropped: CodexParserDropStats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function redactSecrets(value: string, dropped: CodexParserDropStats): string {
  const result = redactText(value);
  dropped.secretsRedacted += result.count;
  return result.text;
}

function boundedText(value: string, dropped: CodexParserDropStats): string {
  const redacted = redactSecrets(value, dropped).trim();
  const result = boundText(redacted, maxTextFieldChars);
  if (result.truncated) dropped.textFieldsTruncated += 1;
  return result.text;
}

function textFromContent(content: unknown, dropped: CodexParserDropStats): string[] {
  if (typeof content === "string") return [boundedText(content, dropped)].filter(Boolean);
  if (!Array.isArray(content)) return [];

  const texts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      dropped.lowSignalEvents += 1;
      continue;
    }
    if ("encrypted_content" in item) {
      dropped.lowSignalEvents += 1;
      continue;
    }
    const text = item.text ?? item.input_text ?? item.output_text;
    if (typeof text === "string") {
      const bounded = boundedText(text, dropped);
      if (bounded) texts.push(bounded);
    } else {
      dropped.lowSignalEvents += 1;
    }
  }
  return texts;
}

function extractCommand(payload: Record<string, unknown>, dropped: CodexParserDropStats): string | undefined {
  if (typeof payload.arguments !== "string") return undefined;
  try {
    const args = JSON.parse(payload.arguments);
    if (isRecord(args) && typeof args.cmd === "string") {
      return boundedText(args.cmd, dropped);
    }
  } catch {
    dropped.lowSignalEvents += 1;
  }
  return undefined;
}

function extractCommandOutput(payload: Record<string, unknown>, dropped: CodexParserDropStats): string | undefined {
  const raw = typeof payload.output === "string" ? payload.output : undefined;
  if (!raw) return undefined;
  const bounded = boundedText(raw, dropped);
  const firstLines = bounded.split(/\r?\n/).slice(0, 3).join("\n");
  if (firstLines.length <= 1_000) return firstLines;
  dropped.textFieldsTruncated += 1;
  return `${firstLines.slice(0, 1_000)}\n[TRUNCATED]`;
}

function extractPaths(text: string): string[] {
  return Array.from(text.matchAll(/\/Users\/frankqdwang\/[A-Za-z0-9._/@:+-]+/g), (match) => match[0]);
}

function pushBounded(target: string[], values: string[], max: number, dropped: CodexParserDropStats): void {
  for (const value of values) {
    if (!value) continue;
    if (target.length >= max) {
      dropped.lowSignalEvents += 1;
      continue;
    }
    target.push(value);
  }
}

function isLowSignalText(value: string): boolean {
  return (
    value.startsWith("# AGENTS.md instructions") ||
    value.includes("<environment_context>") ||
    value.includes("<permissions instructions>") ||
    value.includes("========= MEMORY_SUMMARY BEGINS =========")
  );
}

function pushMeaningfulText(target: string[], texts: string[], max: number, dropped: CodexParserDropStats): void {
  const meaningful = texts.filter((text) => {
    const lowSignal = isLowSignalText(text);
    if (lowSignal) dropped.lowSignalEvents += 1;
    return !lowSignal;
  });
  pushBounded(target, meaningful, max, dropped);
}

function dedupeSessionText(session: ParsedCodexSession): void {
  const seen = new Set<string>();
  const dedupe = (values: string[]): string[] => {
    const result: string[] = [];
    for (const value of values) {
      if (seen.has(value)) {
        session.dropped.lowSignalEvents += 1;
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result;
  };

  session.userGoals = dedupe(session.userGoals);
  session.projectContext = dedupe(session.projectContext);
  session.keyEvents = dedupe(session.keyEvents);
  session.assistantNotes = dedupe(session.assistantNotes);
  session.commandResults = dedupe(session.commandResults);
  session.outcomes = dedupe(session.outcomes);
}

export function parseCodexSessionJsonl(input: ParseCodexSessionInput): ParsedCodexSession {
  const dropped: CodexParserDropStats = {
    malformedLines: 0,
    lowSignalEvents: 0,
    textFieldsTruncated: 0,
    secretsRedacted: 0,
  };
  const session: ParsedCodexSession = {
    sourcePath: input.sourcePath,
    sourceSha256: createHash("sha256").update(input.content).digest("hex"),
    sourceSizeBytes: Buffer.byteLength(input.content),
    sessionId: "unknown-session",
    userGoals: [],
    projectContext: [],
    keyEvents: [],
    assistantNotes: [],
    commands: [],
    commandResults: [],
    filePaths: [],
    outcomes: [],
    dropped,
  };

  for (const rawLine of input.content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      dropped.malformedLines += 1;
      continue;
    }
    if (!isRecord(event) || !isRecord(event.payload)) {
      dropped.lowSignalEvents += 1;
      continue;
    }

    const payload = event.payload;
    const type = typeof payload.type === "string" ? payload.type : typeof event.type === "string" ? event.type : undefined;
    if (typeof event.timestamp === "string" && !session.startedAt) {
      session.startedAt = event.timestamp;
    }

    if (type === "session_meta") {
      if (typeof payload.id === "string") session.sessionId = payload.id;
      if (typeof payload.cwd === "string") session.cwd = boundedText(payload.cwd, dropped);
      if (typeof payload.model === "string") session.model = boundedText(payload.model, dropped);
      if (!session.model && typeof payload.model_provider === "string") session.model = boundedText(payload.model_provider, dropped);
      if (typeof payload.originator === "string") session.originator = boundedText(payload.originator, dropped);
      if (typeof payload.timestamp === "string") session.startedAt = payload.timestamp;
      if (session.cwd) pushBounded(session.projectContext, [`CWD: ${session.cwd}`], 3, dropped);
      continue;
    }

    if (type === "reasoning" || "encrypted_content" in payload) {
      dropped.lowSignalEvents += 1;
      continue;
    }

    if (type === "message") {
      const role = payload.role;
      if (role !== "user" && role !== "assistant") {
        dropped.lowSignalEvents += 1;
        continue;
      }
      const texts = textFromContent(payload.content, dropped);
      for (const text of texts) {
        pushBounded(session.filePaths, extractPaths(text), maxFilePaths, dropped);
      }
      if (role === "user") {
        pushMeaningfulText(session.userGoals, texts, maxUserGoals, dropped);
      } else if (role === "assistant") {
        if (payload.phase === "final" || payload.phase === "final_answer") {
          pushMeaningfulText(session.outcomes, texts, maxOutcomes, dropped);
        } else if (payload.phase === "commentary") {
          pushMeaningfulText(session.assistantNotes, texts, maxAssistantNotes, dropped);
        } else {
          dropped.lowSignalEvents += 1;
        }
      }
      continue;
    }

    if (type === "user_message" && typeof payload.message === "string") {
      pushMeaningfulText(session.userGoals, [boundedText(payload.message, dropped)], maxUserGoals, dropped);
      continue;
    }

    if (type === "agent_message" && typeof payload.message === "string") {
      const message = boundedText(payload.message, dropped);
      if (payload.phase === "final" || payload.phase === "final_answer") {
        pushMeaningfulText(session.outcomes, [message], maxOutcomes, dropped);
      } else if (payload.phase === "commentary") {
        pushMeaningfulText(session.assistantNotes, [message], maxAssistantNotes, dropped);
      } else {
        dropped.lowSignalEvents += 1;
      }
      continue;
    }

    if (type === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const command = extractCommand(payload, dropped);
      if (command) {
        pushBounded(session.commands, [command], maxCommandResults, dropped);
        pushBounded(session.keyEvents, [`Called ${name}: ${command}`], maxAssistantNotes, dropped);
        pushBounded(session.filePaths, extractPaths(command), maxFilePaths, dropped);
      }
      continue;
    }

    if (type === "function_call_output") {
      const output = extractCommandOutput(payload, dropped);
      if (output) {
        pushBounded(session.commandResults, [output], maxCommandResults, dropped);
        pushBounded(session.filePaths, extractPaths(output), maxFilePaths, dropped);
      }
      continue;
    }

    dropped.lowSignalEvents += 1;
  }

  dedupeSessionText(session);
  return session;
}
