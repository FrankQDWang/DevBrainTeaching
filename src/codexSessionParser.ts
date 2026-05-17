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
  engineeringEvents: ParsedCodexEvidenceEvent[];
  dropped: CodexParserDropStats;
}

export interface ParsedCodexEvidenceEvent {
  ordinal: number;
  timestamp?: string;
  source_channel: string;
  kind:
    | "goal"
    | "context"
    | "source_event"
    | "engineering_action"
    | "observed_result"
    | "assistant_observation"
    | "final_outcome"
    | "referenced_file";
  text: string;
  call_id?: string;
  tool_name?: string;
  raw_payload_type?: string;
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

function textFromRecord(value: Record<string, unknown>): string | undefined {
  for (const key of ["text", "input_text", "output_text", "content", "message"]) {
    const text = value[key];
    if (typeof text === "string") return text;
  }
  return undefined;
}

function textFromContent(content: unknown, dropped: CodexParserDropStats): string[] {
  if (typeof content === "string") return [boundedText(content, dropped)].filter(Boolean);
  if (Array.isArray(content)) {
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
      const text = textFromRecord(item);
      if (typeof text === "string") {
        const bounded = boundedText(text, dropped);
        if (bounded) texts.push(bounded);
      } else {
        dropped.lowSignalEvents += 1;
      }
    }
    return texts;
  }
  if (isRecord(content)) {
    const text = textFromRecord(content);
    if (text) return [boundedText(text, dropped)].filter(Boolean);
    dropped.lowSignalEvents += 1;
    return [];
  }
  return [];
}

function extractCommand(payload: Record<string, unknown>, dropped: CodexParserDropStats): string | undefined {
  if (typeof payload.arguments !== "string") return undefined;
  try {
    const args = JSON.parse(payload.arguments);
    if (isRecord(args) && typeof args.cmd === "string") {
      return boundedText(args.cmd, dropped);
    }
    if (isRecord(args) && typeof args.command === "string") {
      return boundedText(args.command, dropped);
    }
    if (isRecord(args) && Array.isArray(args.command) && args.command.every((item) => typeof item === "string")) {
      return boundedText(args.command.join(" "), dropped);
    }
  } catch {
    dropped.lowSignalEvents += 1;
  }
  return undefined;
}

function extractCommandOutput(payload: Record<string, unknown>, dropped: CodexParserDropStats): string | undefined {
  const outputPart = (label: string, value: string): string => {
    const bounded = boundText(value.trim(), 1_000);
    if (bounded.truncated) dropped.textFieldsTruncated += 1;
    return `${label}: ${bounded.text}`;
  };
  let raw = typeof payload.output === "string" ? payload.output : undefined;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) {
        const parts: string[] = [];
        for (const key of ["output", "stdout", "stderr", "content"]) {
          const value = parsed[key];
          if (typeof value === "string") parts.push(outputPart(key, value));
        }
        if (isRecord(parsed.metadata)) {
          const metadata = JSON.stringify(parsed.metadata);
          if (metadata !== "{}") parts.push(outputPart("metadata", metadata));
        }
        if (parts.length > 0) raw = parts.join("\n");
      }
    } catch {
      raw = outputPart("output", raw);
    }
  } else {
    const parts: string[] = [];
    for (const key of ["stdout", "stderr", "content"]) {
      const value = payload[key];
      if (typeof value === "string") parts.push(outputPart(key, value));
      else if (Array.isArray(value)) parts.push(...textFromContent(value, dropped).map((text) => outputPart(key, text)));
      else if (isRecord(value)) parts.push(...textFromContent(value, dropped).map((text) => outputPart(key, text)));
    }
    raw = parts.length > 0 ? parts.join("\n") : undefined;
  }
  if (!raw) return undefined;
  const bounded = boundedText(raw, dropped);
  const firstLines = bounded.split(/\r?\n/).slice(0, 8).join("\n");
  if (firstLines.length <= 2_000) return firstLines;
  dropped.textFieldsTruncated += 1;
  return `${firstLines.slice(0, 2_000)}\n[TRUNCATED]`;
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
    engineeringEvents: [],
    dropped,
  };
  let engineeringOrdinal = 0;

  const addEngineeringEvent = (
    kind: ParsedCodexEvidenceEvent["kind"],
    source_channel: string,
    text: string,
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): void => {
    engineeringOrdinal += 1;
    const timestamp = typeof event.timestamp === "string" ? event.timestamp : undefined;
    const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
    const toolName = typeof payload.name === "string" ? payload.name : undefined;
    const rawPayloadType = typeof payload.type === "string" ? payload.type : typeof event.type === "string" ? event.type : undefined;
    session.engineeringEvents.push({
      ordinal: engineeringOrdinal,
      source_channel,
      kind,
      text,
      ...(timestamp ? { timestamp } : {}),
      ...(callId ? { call_id: callId } : {}),
      ...(toolName ? { tool_name: toolName } : {}),
      ...(rawPayloadType ? { raw_payload_type: rawPayloadType } : {}),
    });
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
      if (session.cwd) addEngineeringEvent("context", "projectContext", `CWD: ${session.cwd}`, event, payload);
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
        for (const text of texts) {
          if (!isLowSignalText(text)) addEngineeringEvent("goal", "userGoals", text, event, payload);
        }
      } else if (role === "assistant") {
        if (payload.phase === "final" || payload.phase === "final_answer" || payload.channel === "final" || payload.status === "completed") {
          pushMeaningfulText(session.outcomes, texts, maxOutcomes, dropped);
          for (const text of texts) {
            if (!isLowSignalText(text)) addEngineeringEvent("final_outcome", "outcomes", text, event, payload);
          }
        } else if (payload.phase === "analysis") {
          dropped.lowSignalEvents += 1;
        } else {
          pushMeaningfulText(session.assistantNotes, texts, maxAssistantNotes, dropped);
          for (const text of texts) {
            if (!isLowSignalText(text)) addEngineeringEvent("assistant_observation", "assistantNotes", text, event, payload);
          }
        }
      }
      continue;
    }

    if (type === "user_message" && typeof payload.message === "string") {
      const message = boundedText(payload.message, dropped);
      pushMeaningfulText(session.userGoals, [message], maxUserGoals, dropped);
      if (!isLowSignalText(message)) addEngineeringEvent("goal", "userGoals", message, event, payload);
      continue;
    }

    if (type === "agent_message" && typeof payload.message === "string") {
      const message = boundedText(payload.message, dropped);
      if (payload.phase === "final" || payload.phase === "final_answer") {
        pushMeaningfulText(session.outcomes, [message], maxOutcomes, dropped);
        addEngineeringEvent("final_outcome", "outcomes", message, event, payload);
      } else if (payload.phase === "commentary") {
        pushMeaningfulText(session.assistantNotes, [message], maxAssistantNotes, dropped);
        addEngineeringEvent("assistant_observation", "assistantNotes", message, event, payload);
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
        addEngineeringEvent("engineering_action", "commands", command, event, payload);
      }
      continue;
    }

    if (type === "function_call_output") {
      const output = extractCommandOutput(payload, dropped);
      if (output) {
        pushBounded(session.commandResults, [output], maxCommandResults, dropped);
        pushBounded(session.filePaths, extractPaths(output), maxFilePaths, dropped);
        addEngineeringEvent("observed_result", "commandResults", output, event, payload);
      }
      continue;
    }

    dropped.lowSignalEvents += 1;
  }

  dedupeSessionText(session);
  return session;
}
