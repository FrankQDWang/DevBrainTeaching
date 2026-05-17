import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCodexSessionJsonl } from "../src/codexSessionParser.js";

function line(payload: unknown, timestamp = "2026-05-14T01:00:00.000Z"): string {
  return JSON.stringify({ timestamp, payload });
}

describe("codex session parser", () => {
  it("keeps compact session facts and provenance", () => {
    const content = [
      line({
        type: "session_meta",
        id: "session-a",
        cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
        model: "gpt-5.5",
        originator: "Codex",
      }),
      line({ type: "message", role: "user", content: [{ text: "Make gbrain ingest safe." }] }),
      line({
        type: "message",
        role: "assistant",
        phase: "commentary",
        content: [{ text: "I will add limit validation." }],
      }),
      line({
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "bun test" }),
      }),
      line({ type: "function_call_output", output: "pass\nall good\n" }),
      line({
        type: "message",
        role: "assistant",
        phase: "final",
        content: [{ text: "Implemented and verified with bun test." }],
      }),
    ].join("\n");

    const session = parseCodexSessionJsonl({
      sourcePath: "/tmp/session.jsonl",
      content,
    });

    expect(session.sessionId).toBe("session-a");
    expect(session.cwd).toBe("/Users/frankqdwang/Agents/DevBrainTeaching");
    expect(session.sourceSha256).toHaveLength(64);
    expect(session.userGoals[0]).toContain("gbrain ingest");
    expect(session.assistantNotes[0]).toContain("limit validation");
    expect(session.commands[0]).toBe("bun test");
    expect(session.commandResults[0]).toContain("pass");
    expect(session.outcomes[0]).toContain("verified");
  });

  it("parses real Codex rollout event shapes and skips environment boilerplate", () => {
    const content = [
      JSON.stringify({
        timestamp: "2026-05-14T01:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "019e2574-d3da-78c2-9030-166e620d334c",
          cwd: "/repo",
          model_provider: "openai",
          originator: "Codex Desktop",
        },
      }),
      line({
        type: "message",
        role: "user",
        content: [{ text: "# AGENTS.md instructions\n<INSTRUCTIONS>noise</INSTRUCTIONS>" }],
      }),
      line({ type: "user_message", message: "好，请帮我修复这个问题。" }),
      line({ type: "agent_message", phase: "final_answer", message: "已经修复并验证。" }),
    ].join("\n");

    const session = parseCodexSessionJsonl({ sourcePath: "/tmp/session.jsonl", content });

    expect(session.sessionId).toBe("019e2574-d3da-78c2-9030-166e620d334c");
    expect(session.cwd).toBe("/repo");
    expect(session.userGoals).toEqual(["好，请帮我修复这个问题。"]);
    expect(session.outcomes).toEqual(["已经修复并验证。"]);
  });

  it("counts malformed lines and drops encrypted or private-reasoning content", () => {
    const content = [
      "not-json",
      line({ type: "message", role: "assistant", phase: "analysis", content: [{ text: "private reasoning" }] }),
      line({ type: "reasoning", content: [{ text: "hidden" }] }),
      line({ type: "message", role: "user", content: [{ encrypted_content: "abc" }] }),
    ].join("\n");

    const session = parseCodexSessionJsonl({ sourcePath: "/tmp/session.jsonl", content });
    const serialized = JSON.stringify(session);

    expect(session.dropped.malformedLines).toBe(1);
    expect(session.dropped.lowSignalEvents).toBeGreaterThanOrEqual(3);
    expect(serialized).not.toContain("private reasoning");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("abc");
  });

  it("redacts secrets from messages, commands, and tool outputs", () => {
    const content = [
      line({ type: "message", role: "user", content: [{ text: "JINA_API_KEY=jina_secret_1234567890" }] }),
      line({
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "curl -H 'Authorization: Bearer abc.def.ghi'" }),
      }),
      line({ type: "function_call_output", output: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz" }),
    ].join("\n");

    const session = parseCodexSessionJsonl({ sourcePath: "/tmp/session.jsonl", content });
    const serialized = JSON.stringify(session);

    expect(serialized).not.toContain("jina_secret_1234567890");
    expect(serialized).not.toContain("abc.def.ghi");
    expect(serialized).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(serialized).toContain("[REDACTED_SECRET]");
    expect(session.dropped.secretsRedacted).toBeGreaterThanOrEqual(3);
  });

  it("covers current Codex JSONL fixture shapes", () => {
    const fixtureDir = join(process.cwd(), "tests/fixtures");
    const fixtureNames = [
      "codex-session-response-item.jsonl",
      "codex-session-event-msg.jsonl",
      "codex-session-large-tool-output.jsonl",
      "codex-session-reasoning-encrypted.jsonl",
      "codex-session-agents-block.jsonl",
    ];
    const parsed = fixtureNames.map((name) =>
      parseCodexSessionJsonl({
        sourcePath: join(fixtureDir, name),
        content: readFileSync(join(fixtureDir, name), "utf8"),
      }),
    );

    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("encrypted_content");
    expect(serialized).not.toContain("private reasoning");
    expect(serialized).not.toContain("# AGENTS.md instructions");
    expect(parsed.some((session) => session.dropped.textFieldsTruncated > 0)).toBe(true);
    expect(parsed.some((session) => session.userGoals.length > 0)).toBe(true);

    const duplicateNeedle = "large duplicated user message unique marker";
    const userGoals = parsed.flatMap((session) => session.userGoals);
    expect(userGoals.filter((goal) => goal.includes(duplicateNeedle))).toHaveLength(1);
  });

  it("extracts response_item command arrays, JSON-wrapped outputs, and ordered engineering events", () => {
    const content = [
      JSON.stringify({
        timestamp: "2026-05-16T01:00:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "shell",
          call_id: "call-1",
          arguments: JSON.stringify({
            command: ["bash", "-lc", "printf '64 pass\\n0 fail\\n'"],
            workdir: "/repo",
          }),
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-16T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({
            output: "64 pass\\n0 fail\\n",
            metadata: { exit_code: 0, duration_seconds: 0.1 },
          }),
        },
      }),
    ].join("\n");

    const session = parseCodexSessionJsonl({ sourcePath: "/tmp/session.jsonl", content });

    expect(session.commands.join("\n")).toContain("bash -lc");
    expect(session.commandResults.join("\n")).toContain("64 pass");
    expect(session.commandResults.join("\n")).toContain("exit_code");
    expect(session.engineeringEvents.map((event) => event.kind)).toEqual(["engineering_action", "observed_result"]);
    expect(session.engineeringEvents.map((event) => event.ordinal)).toEqual([1, 2]);
    expect(session.engineeringEvents[0]).toMatchObject({
      source_channel: "commands",
      call_id: "call-1",
      tool_name: "shell",
      raw_payload_type: "function_call",
      timestamp: "2026-05-16T01:00:00.000Z",
    });
    expect(session.engineeringEvents[1]).toMatchObject({
      source_channel: "commandResults",
      call_id: "call-1",
      raw_payload_type: "function_call_output",
      timestamp: "2026-05-16T01:00:01.000Z",
    });
  });

  it("uses structural final markers and event_msg user messages without keyword inference", () => {
    const content = [
      JSON.stringify({
        timestamp: "2026-05-16T01:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Build engineering experience episodes from Codex sessions.",
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-16T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ text: "implemented keyword but no final marker" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-16T01:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          channel: "final",
          content: [{ output_text: "Implemented with structural final marker." }],
        },
      }),
    ].join("\n");

    const session = parseCodexSessionJsonl({ sourcePath: "/tmp/session.jsonl", content });

    expect(session.userGoals.join("\n")).toContain("engineering experience");
    expect(session.assistantNotes.join("\n")).toContain("implemented keyword but no final marker");
    expect(session.outcomes.join("\n")).toContain("structural final marker");
    expect(session.outcomes.join("\n")).not.toContain("keyword but no final marker");
    expect(session.engineeringEvents.map((event) => event.kind)).toEqual(["goal", "assistant_observation", "final_outcome"]);
  });

  it("handles content object and stdout/stderr fallback while dropping encrypted reasoning", () => {
    const huge = "x".repeat(3_000);
    const content = [
      "not-json",
      JSON.stringify({
        timestamp: "2026-05-16T01:00:00.000Z",
        type: "response_item",
        payload: { type: "reasoning", encrypted_content: "secret-reasoning" },
      }),
      JSON.stringify({
        timestamp: "2026-05-16T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: { text: "Investigate content object." },
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-16T01:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-2",
          stdout: `stdout line\n${huge}`,
          stderr: "stderr line",
        },
      }),
    ].join("\n");

    const session = parseCodexSessionJsonl({ sourcePath: "/tmp/session.jsonl", content });
    const serialized = JSON.stringify(session);

    expect(session.userGoals.join("\n")).toContain("Investigate content object");
    expect(session.commandResults.join("\n")).toContain("stdout line");
    expect(session.commandResults.join("\n")).toContain("stderr line");
    expect(session.dropped.malformedLines).toBe(1);
    expect(session.dropped.textFieldsTruncated).toBeGreaterThan(0);
    expect(serialized).not.toContain("secret-reasoning");
  });
});
