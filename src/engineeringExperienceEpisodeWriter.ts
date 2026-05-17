import type { EngineeringExperienceEpisode, EngineeringExperienceItemKind } from "./engineeringExperienceEpisode.js";

export const engineeringEpisodeRendererVersion = "engineering-episode-renderer-v1";

const maxEpisodeChars = 50_000;

function yaml(value: string | undefined): string {
  return JSON.stringify(value ?? "");
}

function list(values: string[], fallback = "Not captured."): string {
  if (values.length === 0) return `- ${fallback}`;
  return values.map((value) => `- ${value.replace(/\n/g, "\n  ")}`).join("\n");
}

function itemList(episode: EngineeringExperienceEpisode, kind: EngineeringExperienceItemKind): string {
  return list(
    episode.observed_sequence
      .filter((item) => item.kind === kind)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((item) => `[${item.source_channel}] ${item.text}`),
  );
}

function ensureCap(value: string): string {
  if (value.length > maxEpisodeChars) {
    throw new Error(`Rendered engineering episode exceeds ${maxEpisodeChars} chars; item-level bounds should prevent this.`);
  }
  return value;
}

export function renderEngineeringExperienceEpisode(episode: EngineeringExperienceEpisode): string {
  return ensureCap(`---
type: engineering-experience-episode
schema_version: ${episode.schema_version}
episode_version: ${yaml(episode.episode_version)}
source_kind: ${yaml(episode.source_kind)}
source_adapter: ${yaml(episode.source_adapter)}
source_id: ${yaml(episode.source_id)}
source_sha256: ${yaml(episode.source_sha256)}
started_at: ${yaml(episode.started_at)}
dream_generated: false
tags: ["engineering-experience", "codex-session", "raw-material"]
---

# Engineering Experience Episode

## Engineering Problem
${list(episode.problem_statement)}

## Workspace Context
${list(episode.engineering_context)}

## Observed Engineering Sequence
### Goals And Context
${itemList(episode, "goal")}
${itemList(episode, "context")}

### Actions
${itemList(episode, "engineering_action")}

### Results
${itemList(episode, "observed_result")}

### Assistant Observations
${itemList(episode, "assistant_observation")}

### Final Outcomes
${itemList(episode, "final_outcome")}

### Referenced Files
${itemList(episode, "referenced_file")}

## Trust Boundary
${list(episode.trust_boundary)}

## Source Appendix
- Source kind: ${episode.source_kind}
- Source adapter: ${episode.source_adapter}
- Source ID: ${episode.source_id.replace(/\n/g, " ")}
- Source path: ${episode.source_path_redacted}
- Workspace: ${episode.workspace_redacted ?? "Not captured."}
- Model: ${episode.model ?? "Not captured."}
`);
}
