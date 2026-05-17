import { describe, expect, it } from "bun:test";

import { buildCodexEngineeringEpisode } from "../src/engineeringExperienceEpisode.js";
import { renderEngineeringExperienceEpisode } from "../src/engineeringExperienceEpisodeWriter.js";
import type { ParsedCodexSession } from "../src/codexSessionParser.js";

function parsed(overrides: Partial<ParsedCodexSession> = {}): ParsedCodexSession {
  return {
    sourcePath: "/tmp/session-a.jsonl",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 123,
    sessionId: "session-a",
    cwd: "/repo",
    model: "gpt-5.5",
    startedAt: "2026-05-16T01:00:00.000Z",
    userGoals: ["Build engineering experience episodes."],
    projectContext: ["CWD: /repo"],
    keyEvents: ["Need source-backed raw material."],
    assistantNotes: ["I will preserve the boundary."],
    commands: ["bun test"],
    commandResults: ["64 pass 0 fail"],
    filePaths: ["/repo/src/index.ts"],
    outcomes: ["Implemented and verified."],
    engineeringEvents: [],
    dropped: {
      malformedLines: 1,
      lowSignalEvents: 2,
      textFieldsTruncated: 3,
      secretsRedacted: 4,
    },
    ...overrides,
  };
}

describe("engineering experience episode writer", () => {
  it("renders engineering corpus text with source channels and without debug verdicts", () => {
    const rendered = renderEngineeringExperienceEpisode(buildCodexEngineeringEpisode(parsed()).episode);

    expect(rendered).toContain("type: engineering-experience-episode");
    expect(rendered).toContain("# Engineering Experience Episode");
    expect(rendered).toContain("## Engineering Problem");
    expect(rendered).toContain("## Workspace Context");
    expect(rendered).toContain("## Observed Engineering Sequence");
    expect(rendered).toContain("### Actions");
    expect(rendered).toContain("- [commands] bun test");
    expect(rendered).toContain("### Results");
    expect(rendered).toContain("- [commandResults] 64 pass");
    expect(rendered).toContain("## Trust Boundary");
    expect(rendered).toContain("GBrain decides what, if anything, should be synthesized.");

    expect(rendered).not.toContain("likely_engineering_reviewable");
    expect(rendered).not.toContain("likely_dream_reviewable");
    expect(rendered).not.toContain("Envelope quality");
    expect(rendered).not.toContain("Malformed lines");
    expect(rendered).not.toContain("Low-signal events");
    expect(rendered).not.toContain("Secrets redacted");
    expect(rendered).not.toContain("Text fields truncated");
    expect(rendered).not.toContain("promotion");
    expect(rendered).not.toContain("durable lesson");
  });

  it("escapes source-derived frontmatter scalars", () => {
    const injected = buildCodexEngineeringEpisode(
      parsed({
        sessionId: "abc\ndef: injected\n---",
      }),
    ).episode;
    const rendered = renderEngineeringExperienceEpisode(injected);

    expect(rendered).toContain("source_id:");
    expect(rendered).not.toMatch(/^def: injected$/m);
    expect(rendered.match(/^---$/gm)).toHaveLength(2);
  });
});
