import { describe, expect, it } from "bun:test";

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
});
