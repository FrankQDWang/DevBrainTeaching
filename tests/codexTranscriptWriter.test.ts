import { describe, expect, it } from "bun:test";

import type { ParsedCodexSession } from "../src/codexSessionParser.js";
import {
  renderCodexManifest,
  renderCodexTranscript,
  safeSlug,
  transcriptFilename,
} from "../src/codexTranscriptWriter.js";

function parsed(overrides: Partial<ParsedCodexSession> = {}): ParsedCodexSession {
  return {
    sourcePath: "/Users/frankqdwang/.codex/sessions/session.jsonl",
    sourceSha256: "a".repeat(64),
    sourceSizeBytes: 123,
    sessionId: "session-a",
    cwd: "/Users/frankqdwang/Agents/DevBrainTeaching",
    model: "gpt-5.5",
    originator: "Codex",
    startedAt: "2026-05-14T01:00:00.000Z",
    userGoals: ["Make Codex session ingestion safe."],
    projectContext: ["CWD: /Users/frankqdwang/Agents/DevBrainTeaching"],
    keyEvents: ["Added runtime git ignore enforcement."],
    assistantNotes: ["Decision: use a dedicated non-federated source because raw JSONL is noisy."],
    commands: ["bun test"],
    commandResults: ["bun test -> pass"],
    filePaths: ["/Users/frankqdwang/Agents/DevBrainTeaching/src/index.ts"],
    outcomes: ["Implemented and verified."],
    dropped: {
      malformedLines: 0,
      lowSignalEvents: 2,
      textFieldsTruncated: 1,
      secretsRedacted: 1,
    },
    ...overrides,
  };
}

describe("codex transcript writer", () => {
  it("renders the spec-aligned transcript sections", () => {
    const markdown = renderCodexTranscript(parsed());

    expect(markdown).toContain("schema_version: 1");
    expect(markdown).toContain("## User Goal");
    expect(markdown).toContain("## Decisions And Tradeoffs");
    expect(markdown).toContain("## Errors And Root Causes");
    expect(markdown).toContain("## Reusable Lessons");
    expect(markdown).toContain("Secrets redacted: 1");
  });

  it("sanitizes session IDs used in filenames", () => {
    expect(safeSlug("../../evil")).toBe("evil");
    expect(transcriptFilename(parsed({ sessionId: "../../evil" }))).toBe("2026-05-14-evil.md");
  });

  it("renders manifest provenance and hardening statistics", () => {
    const manifest = JSON.parse(renderCodexManifest([parsed()], "2026-05-14T02:00:00.000Z"));

    expect(manifest.generated_at).toBe("2026-05-14T02:00:00.000Z");
    expect(manifest.sessions[0].source_sha256).toHaveLength(64);
    expect(manifest.sessions[0].text_fields_truncated).toBe(1);
    expect(manifest.sessions[0].secrets_redacted).toBe(1);
  });
});
