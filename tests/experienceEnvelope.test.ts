import { describe, expect, it } from "bun:test";

import type { ParsedCodexSession } from "../src/codexSessionParser.js";
import { buildCodexExperienceEnvelope, experienceEnvelopeVersion } from "../src/experienceEnvelope.js";

const home = process.env.HOME ?? "/tmp/home";

function homePath(suffix: string): string {
  return `${home}${suffix}`;
}

function parsed(overrides: Partial<ParsedCodexSession> = {}): ParsedCodexSession {
  return {
    sourcePath: homePath("/.codex/sessions/s.jsonl"),
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 100,
    sessionId: "session-a",
    cwd: homePath("/Agents/DevBrainTeaching"),
    model: "gpt-5.5",
    originator: "Codex Desktop",
    startedAt: "2026-05-16T01:00:00.000Z",
    userGoals: ["Make the gbrain adapter reusable."],
    projectContext: [`CWD: ${homePath("/Agents/DevBrainTeaching")}`],
    keyEvents: ["Called exec_command: bun test"],
    assistantNotes: ["Decision: keep DevBrainTeaching deterministic because gbrain owns synthesis."],
    commands: ["bun test", "bun run gbrain-v5-dream-check"],
    commandResults: ["64 pass 0 fail", "ready true"],
    filePaths: [homePath("/Agents/DevBrainTeaching/src/index.ts")],
    outcomes: ["Added a v5 wrapper and verified it."],
    dropped: {
      malformedLines: 0,
      lowSignalEvents: 2,
      textFieldsTruncated: 1,
      secretsRedacted: 3,
    },
    ...overrides,
  };
}

describe("experience envelope", () => {
  it("maps Codex data through structural source channels only", () => {
    const { envelope } = buildCodexExperienceEnvelope(parsed());

    expect(envelope.envelope_version).toBe(experienceEnvelopeVersion);
    expect(envelope.source_kind).toBe("codex-session");
    expect(envelope.source_adapter).toBe("codex-session-adapter-v1");
    expect(envelope.source_id).toBe("session-a");
    expect(envelope.source_path_redacted).toBe("$HOME/.codex/sessions/s.jsonl");
    expect(envelope.workspace_redacted).toBe("$HOME/Agents/DevBrainTeaching");
    expect(envelope.goal).toEqual(["Make the gbrain adapter reusable."]);
    expect(envelope.evidence.some((item) => item.kind === "source_event" && item.source_channel === "keyEvents")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "tool_call" && item.source_channel === "commands")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "tool_result" && item.source_channel === "commandResults")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "assistant_commentary" && item.source_channel === "assistantNotes")).toBe(true);
    expect(envelope.evidence.some((item) => item.kind === "assistant_final" && item.source_channel === "outcomes")).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain(home);
    expect(JSON.stringify(envelope)).not.toContain("likely_dream_reviewable");
    expect(JSON.stringify(envelope)).not.toContain("\"quality\"");
    expect(envelope.evidence.length).toBeLessThanOrEqual(30);
  });

  it("does not infer lessons, failures, fixes, decisions, or verification from keywords", () => {
    const { envelope } = buildCodexExperienceEnvelope(
      parsed({
        commandResults: ["error: test failed after fix"],
        assistantNotes: ["Decision: fixed because tests failed"],
      }),
    );
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toContain("\"failure\"");
    expect(serialized).not.toContain("\"fix\"");
    expect(serialized).not.toContain("\"verification\"");
    expect(serialized).not.toContain("\"decision\"");
    expect(serialized).not.toContain("\"lesson\"");
  });

  it("preserves duplicate evidence as ordered source observations", () => {
    const { envelope } = buildCodexExperienceEnvelope(
      parsed({
        keyEvents: [],
        commands: ["bun test", "bun test"],
        commandResults: [],
      }),
    );
    const toolCalls = envelope.evidence.filter((item) => item.kind === "tool_call");

    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((item) => item.ordinal)).toEqual([1, 2]);
  });

  it("computes debug quality outside the corpus envelope", () => {
    const { envelope, quality } = buildCodexExperienceEnvelope(
      parsed({
        projectContext: [`CWD: ${homePath("/Agents/DevBrainTeaching")}`],
        userGoals: [],
        keyEvents: [],
        commands: [],
        commandResults: [],
        outcomes: [],
      }),
    );

    expect("quality" in envelope).toBe(false);
    expect(quality.has_goal).toBe(false);
    expect(quality.has_source_event).toBe(false);
    expect(quality.has_tool_call).toBe(false);
    expect(quality.has_assistant_final).toBe(false);
    expect(quality.redacted_count).toBeGreaterThan(0);
    expect(quality.likely_dream_reviewable).toBe(false);
    expect(quality.notes).toContain("Missing goal evidence.");
  });
});
