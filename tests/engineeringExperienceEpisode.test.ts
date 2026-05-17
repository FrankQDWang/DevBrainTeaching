import { describe, expect, it } from "bun:test";

import type { ParsedCodexSession } from "../src/codexSessionParser.js";
import { buildCodexEngineeringEpisode, engineeringExperienceEpisodeVersion } from "../src/engineeringExperienceEpisode.js";

function parsed(overrides: Partial<ParsedCodexSession> = {}): ParsedCodexSession {
  const home = process.env.HOME ?? "/tmp/home";
  return {
    sourcePath: `${home}/.codex/sessions/session-a.jsonl`,
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 123,
    sessionId: "session-a",
    cwd: `${home}/Agents/DevBrainTeaching`,
    model: "gpt-5.5",
    startedAt: "2026-05-16T01:00:00.000Z",
    userGoals: ["Build engineering experience episodes."],
    projectContext: [`CWD: ${home}/Agents/DevBrainTeaching`],
    keyEvents: ["Need source-backed raw material."],
    assistantNotes: ["I will preserve the boundary."],
    commands: ["bun test", "bun test"],
    commandResults: ["64 pass 0 fail"],
    filePaths: [`${home}/Agents/DevBrainTeaching/src/index.ts`],
    outcomes: ["Implemented and verified."],
    engineeringEvents: [
      {
        ordinal: 1,
        timestamp: "2026-05-16T01:00:00.000Z",
        source_channel: "userGoals",
        kind: "goal",
        text: "Build engineering experience episodes.",
        raw_payload_type: "user_message",
      },
      {
        ordinal: 2,
        timestamp: "2026-05-16T01:00:01.000Z",
        source_channel: "commands",
        kind: "engineering_action",
        text: "bun test",
        call_id: "call-1",
        tool_name: "exec_command",
        raw_payload_type: "function_call",
      },
      {
        ordinal: 3,
        timestamp: "2026-05-16T01:00:02.000Z",
        source_channel: "commandResults",
        kind: "observed_result",
        text: "64 pass 0 fail",
        call_id: "call-1",
        raw_payload_type: "function_call_output",
      },
    ],
    dropped: {
      malformedLines: 1,
      lowSignalEvents: 2,
      textFieldsTruncated: 0,
      secretsRedacted: 0,
    },
    ...overrides,
  };
}

describe("engineering experience episode", () => {
  it("maps Codex parser output into source-backed engineering evidence without quality leakage", () => {
    const { episode, quality } = buildCodexEngineeringEpisode(parsed());
    const serialized = JSON.stringify(episode);
    const home = process.env.HOME;

    expect(episode.episode_version).toBe(engineeringExperienceEpisodeVersion);
    expect(episode.source_adapter).toBe("codex-engineering-adapter-v1");
    expect(episode.problem_statement).toContain("Build engineering experience episodes.");
    expect(episode.observed_sequence.some((item) => item.kind === "engineering_action" && item.source_channel === "commands")).toBe(true);
    expect(episode.observed_sequence.some((item) => item.kind === "observed_result" && item.source_channel === "commandResults")).toBe(true);
    expect(episode.observed_sequence.some((item) => item.provenance.call_id === "call-1")).toBe(true);
    if (home) expect(serialized).not.toContain(home);
    expect(serialized).not.toContain("likely_engineering_reviewable");
    expect("quality" in episode).toBe(false);
    expect(quality.has_problem).toBe(true);
    expect(quality.has_action).toBe(true);
    expect(quality.has_result).toBe(true);
    expect(quality.malformed_count).toBe(1);
    expect(quality.low_signal_count).toBe(2);
  });

  it("preserves duplicate legacy commands as separate ordered observations", () => {
    const { episode } = buildCodexEngineeringEpisode(parsed({ engineeringEvents: [] }));
    const actions = episode.observed_sequence.filter((item) => item.kind === "engineering_action");

    expect(actions.map((item) => item.ordinal)).toEqual([4, 5]);
    expect(actions.map((item) => item.text)).toEqual(["bun test", "bun test"]);
  });

  it("does not introduce final lesson or promotion claims", () => {
    const { episode } = buildCodexEngineeringEpisode(parsed());
    const serialized = JSON.stringify(episode);

    expect(serialized).not.toContain("\"lesson\"");
    expect(serialized).not.toContain("\"promotion\"");
  });

  it("prefers parser engineering events over legacy arrays when present", () => {
    const { episode } = buildCodexEngineeringEpisode(parsed());

    expect(episode.observed_sequence.map((item) => item.provenance.source_event_ordinal)).toEqual([1, 2, 3]);
    expect(episode.observed_sequence[1]?.provenance.call_id).toBe("call-1");
    expect(episode.observed_sequence[2]?.provenance.call_id).toBe("call-1");
  });
});
