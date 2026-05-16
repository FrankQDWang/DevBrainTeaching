import type { ExperienceEvidenceEnvelope, ExperienceEvidenceKind } from "./experienceEnvelope.js";

const maxEnvelopeChars = 50_000;

function yaml(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

function list(values: string[], fallback = "Not captured."): string {
  if (values.length === 0) return `- ${fallback}`;
  return values.map((value) => `- ${value.replace(/\n/g, "\n  ")}`).join("\n");
}

function evidenceList(envelope: ExperienceEvidenceEnvelope, kind: ExperienceEvidenceKind): string {
  return list(
    envelope.evidence
      .filter((item) => item.kind === kind)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((item) => `[${item.source_channel}] ${item.text}`),
  );
}

function ensureCap(value: string): string {
  if (value.length > maxEnvelopeChars) {
    throw new Error(`Rendered envelope exceeds ${maxEnvelopeChars} chars; item-level bounds should prevent this.`);
  }
  return value;
}

export function renderExperienceEnvelope(envelope: ExperienceEvidenceEnvelope): string {
  return ensureCap(`---
type: experience-evidence-envelope
schema_version: ${envelope.schema_version}
envelope_version: ${yaml(envelope.envelope_version)}
source_kind: ${yaml(envelope.source_kind)}
source_adapter: ${yaml(envelope.source_adapter)}
source_id: ${yaml(envelope.source_id)}
source_sha256: ${yaml(envelope.source_sha256)}
started_at: ${yaml(envelope.started_at)}
dream_generated: false
tags: ["experience-evidence", "raw-material"]
---
# Experience Evidence Envelope

## Goal
${list(envelope.goal)}

## Context
${list(envelope.context)}

## Observed Evidence
### Source Events
${evidenceList(envelope, "source_event")}

### Tool Calls
${evidenceList(envelope, "tool_call")}

### Tool Results
${evidenceList(envelope, "tool_result")}

### Assistant Commentary
${evidenceList(envelope, "assistant_commentary")}

### Assistant Final Output
${evidenceList(envelope, "assistant_final")}

### Referenced Files
${evidenceList(envelope, "referenced_file")}

## Trust Boundary
${list(envelope.trust_boundary)}

## Source Appendix
- Source kind: ${envelope.source_kind}
- Source adapter: ${envelope.source_adapter}
- Source ID: ${envelope.source_id}
- Source path: ${envelope.source_path_redacted}
- Workspace: ${envelope.workspace_redacted ?? "Not captured."}
- Model: ${envelope.model ?? "Not captured."}
`);
}
