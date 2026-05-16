import { describe, expect, it } from "bun:test";

import type { ExperienceEvidenceEnvelope } from "../src/experienceEnvelope.js";
import { renderExperienceEnvelope } from "../src/experienceEnvelopeWriter.js";

function envelope(): ExperienceEvidenceEnvelope {
  return {
    schema_version: 1,
    envelope_version: "experience-evidence-envelope-v1",
    source_kind: "codex-session",
    source_adapter: "codex-session-adapter-v1",
    source_id: "session-a",
    source_sha256: "a".repeat(64),
    source_path_redacted: "$HOME/.codex/sessions/s.jsonl",
    workspace_redacted: "$HOME/Agents/DevBrainTeaching",
    started_at: "2026-05-16T01:00:00.000Z",
    model: "gpt-5.5",
    goal: ["Make evidence generic."],
    context: ["CWD: $HOME/Agents/DevBrainTeaching"],
    evidence: [
      { kind: "source_event", source_channel: "keyEvents", text: "Called exec_command: bun test", ordinal: 1, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
      { kind: "tool_call", source_channel: "commands", text: "bun test", ordinal: 2, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
      { kind: "tool_result", source_channel: "commandResults", text: "64 pass 0 fail", ordinal: 3, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
      { kind: "assistant_final", source_channel: "outcomes", text: "Dry-run completed.", ordinal: 4, provenance: { source_kind: "codex-session", source_id: "session-a", source_sha256: "a".repeat(64) } },
    ],
    trust_boundary: ["This is raw evidence, not durable knowledge."],
  };
}

describe("experience envelope writer", () => {
  it("renders envelope-first text for gbrain dream without debug readiness hints", () => {
    const text = renderExperienceEnvelope(envelope());

    expect(text).toContain("type: experience-evidence-envelope");
    expect(text).toContain("# Experience Evidence Envelope");
    expect(text).toContain("## Observed Evidence");
    expect(text).toContain("### Source Events");
    expect(text).toContain("[keyEvents] Called exec_command: bun test");
    expect(text).toContain("### Tool Calls");
    expect(text).toContain("[commands] bun test");
    expect(text).toContain("### Tool Results");
    expect(text).toContain("[commandResults] 64 pass 0 fail");
    expect(text).toContain("### Assistant Final Output");
    expect(text).toContain("[outcomes] Dry-run completed.");
    expect(text).toContain("This is raw evidence, not durable knowledge.");
    expect(text).not.toContain("Likely dream");
    expect(text).not.toContain("likely_dream");
    expect(text).not.toContain("Malformed lines");
    expect(text).not.toContain("Secrets redacted");
  });
});
