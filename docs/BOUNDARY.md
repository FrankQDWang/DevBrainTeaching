# Boundary With GBrain

GBrain is the knowledge substrate. DevBrain Teaching is an output layer.

## Keep In GBrain

- Source ingestion.
- Pages, facts, takes, links, timelines, raw data, and search indexes.
- Brain-first lookup, entity resolution, and source attribution.
- Generic improvements that benefit all gbrain users.

## Keep In DevBrain Teaching

- Teaching candidate selection criteria.
- Candidate review reports.
- 1.5-5 minute teaching brief generation.
- Script, TTS, storyboard, rendering, and publication gates.
- Project-specific quality thresholds and editorial taste.

## Integration Rule

Use gbrain as an external dependency unless there is a strong reason not to:

```text
DevBrainTeaching -> gbrain CLI/MCP -> gbrain data
```

Do not import gbrain internal TypeScript modules or write directly into its
database schema in the first iteration.

## Codex Sessions

Codex App sessions are raw material. DevBrainTeaching may collect, redact,
compact, and stage them as a transcript corpus. GBrain owns the decision about
what becomes reflections, facts, patterns, takes, or searchable memory through
dream/autopilot.

Do not make this repo generate final durable lessons from Codex sessions. That
turns the adapter into the knowledge engine and bypasses gbrain.
