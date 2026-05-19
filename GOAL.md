# DevBrainTeaching Goal

## North Star

DevBrainTeaching turns my real Codex sessions into a durable software-engineering learning system.

The goal is not to summarize chats for their own sake, and not to let AI simply replace my coding or thinking. The goal is to help me build clearer engineering understanding, vocabulary, and problem-framing ability from the work I already do every day.

In plain language:

> Use all of my Codex sessions as raw material, continuously extract real engineering problems from them, keep those problems in a pool, and regularly turn the most valuable one into a short explanation video.

## Intended Workflow

1. **Collect raw material**
   - Periodically read all available Codex sessions.
   - Treat sessions as private, untrusted raw material.
   - Do not rely on manual copy/paste or hand-picked examples.

2. **Normalize and protect**
   - Redact secrets and sensitive local details.
   - Drop low-signal or unsafe content.
   - Compress sessions into bounded, source-backed engineering evidence.
   - Preserve enough provenance to understand where an issue came from.

3. **Build an engineering problem pool**
   - Extract concrete software-engineering problems from sessions.
   - Keep raw materials and candidate problems separate from final lessons.
   - Prefer problems that improve engineering understanding, terminology, and requirement clarity.

4. **Select one important problem regularly**
   - On a regular cadence, ideally daily, choose one high-value problem from the pool.
   - Selection should consider usefulness, recurrence, conceptual value, and whether the topic helps me express future requirements more precisely.
   - Selection must follow an explicit scoring process, not an ad hoc manual choice.
   - When a problem has already been discussed or turned into a teaching artifact, its priority should drop immediately.
   - That priority should slowly recover over time, so important recurring themes can return later without dominating every day.

5. **Produce a short teaching artifact**
   - Turn the selected problem into a Chinese explanation with key English technical terms.
   - Target video length: 1.5 to 5 minutes.
   - The output should explain the problem, the engineering concept behind it, why it matters, and how to describe it better next time.

## What Counts As Valuable

Good candidates include:

- A real bug, failure mode, or root cause from my work.
- A recurring pattern in how I use Codex or describe requirements.
- A software architecture concept that appeared in practice.
- A precise term that helps replace vague descriptions.
- A boundary, contract, migration, config, auth, data, testing, deployment, or observability issue.
- A mismatch between what I meant and what the coding agent implemented.

Examples of useful concepts:

- idempotency
- source of truth
- contract boundary
- semantic mismatch
- migration gate
- capability probe
- OIDC
- pgvector
- embedding dimension
- state/config drift

The system does not need every extracted point to be a perfect concept. If ten extracted points contain one or two strong engineering concepts, that is already useful.

## System Boundary

DevBrainTeaching should be the adapter and quality gate.

It owns:

- Collecting Codex sessions.
- Redacting and bounding content.
- Normalizing sessions into engineering evidence.
- Writing ignored local corpus/state/report artifacts.
- Making the material suitable for gbrain to consume.

gbrain should be the long-term memory and synthesis engine.

It owns:

- Deciding what is worth remembering.
- Synthesizing durable knowledge.
- Finding recurring themes.
- Supporting the daily problem-selection workflow.
- Helping produce teaching material from selected problems.

DevBrainTeaching should not directly pretend that every extracted item is a final lesson. It should preserve raw material and candidate problems so that later synthesis can remain auditable.

## Non-Goals

- Do not import raw Codex JSONL directly into long-term memory.
- Do not expose private sessions, secrets, local credentials, or raw tool logs.
- Do not make every session into a polished lesson.
- Do not optimize for meeting notes, email, CEO memory, or generic personal CRM.
- Do not collapse the workflow into a one-off manual summary.
- Do not fork or deeply modify gbrain unless a stable adapter boundary is insufficient.

## Current Stage

The project has started building the early adapter layer:

- Codex sessions can be collected and transformed into gbrain-consumable engineering material.
- Local runtime and model routing have been configured for this repository.
- A small test run proved that gbrain can consume the generated material and write synthesized pages.

The next major product gap is the problem-pool and daily-selection layer:

- Define the shape of an extracted engineering problem.
- Store candidate problems separately from final lessons.
- Rank or select one high-value problem per day.
- Define the selection score, including freshness, recurrence, learning value, concept clarity, and prior-discussion decay.
- Track whether a problem has already been discussed, and apply immediate downranking plus slow time-based recovery.
- Generate a 1.5 to 5 minute Chinese teaching script with key English terms.

## Success Criteria

This project is working when:

- It can regularly read my Codex sessions without manual selection.
- It produces a growing pool of real engineering problems from my own work.
- It helps me learn precise software-engineering concepts from those problems.
- It improves how I describe requirements, bugs, constraints, and architecture decisions.
- It can choose one valuable topic per day and turn it into a short teaching artifact.
- Previously discussed topics are not repeatedly selected too soon, but can resurface after enough time if they remain important.
- The whole workflow remains private, auditable, repeatable, and mostly automated.
