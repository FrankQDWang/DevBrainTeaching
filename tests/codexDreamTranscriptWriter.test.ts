import { describe, expect, it } from "bun:test";

import type { ParsedCodexSession } from "../src/codexSessionParser.js";
import { dreamTranscriptFilename, renderDreamTranscript } from "../src/codexDreamTranscriptWriter.js";

function session(): ParsedCodexSession {
  return {
    sourcePath: "/Users/frankqdwang/.codex/sessions/s.jsonl",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 123,
    sessionId: "../../bad",
    cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
    model: "gpt-5.5",
    originator: "Codex",
    startedAt: "2026-05-14T01:00:00.000Z",
    userGoals: ["Build a persistent gbrain adapter."],
    projectContext: ["CWD: /Users/frankqdwang/Agents/DevBrainTeaching"],
    keyEvents: ["Called exec_command: bun test"],
    assistantNotes: ["Decision: feed gbrain dream instead of manual reports."],
    commands: ["bun test"],
    commandResults: ["pass"],
    filePaths: ["/Users/frankqdwang/Agents/DevBrainTeaching/src/index.ts"],
    outcomes: ["Implemented and verified."],
    dropped: { malformedLines: 0, lowSignalEvents: 1, textFieldsTruncated: 0, secretsRedacted: 0 },
  };
}

describe("dream transcript writer", () => {
  it("renders raw material for gbrain dream without claiming final lessons", () => {
    const markdown = renderDreamTranscript(session());
    expect(markdown).toContain("type: codex-session-transcript");
    expect(markdown).toContain("dream_generated: false");
    expect(markdown).toContain('source_path_redacted: "$HOME/.codex/sessions/s.jsonl"');
    expect(markdown).toContain('cwd_redacted: "$HOME/Agents/DevBrainTeaching"');
    expect(markdown).toContain("## Reusable Raw Material");
    expect(markdown).toContain("## Trust Boundary");
    expect(markdown).not.toContain("promotion_ready");
    expect(markdown).not.toContain("/Users/frankqdwang");
  });

  it("sanitizes filenames", () => {
    expect(dreamTranscriptFilename(session())).toMatch(/^2026-05-14-bad-[a-f0-9]{8}\.txt$/);
  });
});
