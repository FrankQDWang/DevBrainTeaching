# DevBrain Teaching

DevBrain Teaching is a separate teaching-video output layer for a local
`gbrain` installation.

## Boundary

This project should stay decoupled from the upstream gbrain checkout:

- Do not modify `/Users/frankqdwang/Agents/DevBrain` for product-specific
  teaching workflows.
- Read gbrain through stable CLI/MCP surfaces first.
- Store teaching candidates, review reports, briefs, and later video artifacts
  under this project.
- Propose small upstream gbrain patches only when a missing generic API blocks
  the workflow.

## Local Layout

```text
/Users/frankqdwang/Agents/
  DevBrain/          # clean upstream gbrain clone
  DevBrainTeaching/  # this project
```

## First Commands

```bash
bun run doctor
bun run candidates
```

`doctor` checks that the gbrain CLI is callable. `candidates` currently prints
the read-only command plan for the first candidate-quality slice.

If the global `gbrain` command is not the checkout you want, point this project
at a specific binary:

```bash
GBRAIN_BIN=/path/to/gbrain bun run doctor
```
