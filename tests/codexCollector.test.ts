import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { collectCodexSessions } from "../src/codexCollector.js";

function root(): string {
  return mkdtempSync(join(tmpdir(), "codex-collector-"));
}

function writeSession(path: string, id: string, userText = "Build gbrain adapter."): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      JSON.stringify({ timestamp: "2026-05-14T01:00:00.000Z", payload: { type: "session_meta", id, cwd: "/repo" } }),
      JSON.stringify({ timestamp: "2026-05-14T01:01:00.000Z", payload: { type: "message", role: "user", content: [{ text: userText }] } }),
    ].join("\n"),
  );
}

function writeRichSession(path: string, id: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      JSON.stringify({ timestamp: "2026-05-14T01:00:00.000Z", payload: { type: "session_meta", id, cwd: "/repo" } }),
      JSON.stringify({ timestamp: "2026-05-14T01:01:00.000Z", payload: { type: "message", role: "user", content: [{ text: "Build gbrain adapter." }] } }),
      JSON.stringify({ timestamp: "2026-05-14T01:02:00.000Z", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "bun test" }) } }),
      JSON.stringify({ timestamp: "2026-05-14T01:03:00.000Z", payload: { type: "function_call_output", output: "64 pass 0 fail" } }),
      JSON.stringify({ timestamp: "2026-05-14T01:04:00.000Z", payload: { type: "message", role: "assistant", phase: "final", content: [{ text: "Implemented and verified." }] } }),
    ].join("\n"),
  );
}

describe("codex collector", () => {
  it("writes dream corpus and state without gbrain calls", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const engineeringCorpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-engineering");
    const rawEnvelopeDir = join(dir, ".devbrain-teaching/debug/envelopes/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeRichSession(join(sessionsDir, "s.jsonl"), "session-a");

    const result = collectCodexSessions({
      sessionsDir,
      engineeringCorpusDir,
      rawEnvelopeDir,
      statePath,
      runRoot,
      limit: 20,
      isPathIgnored: () => true,
      now: () => new Date("2026-05-14T02:00:00.000Z"),
    });

    expect(result.corpusDir).toBe(engineeringCorpusDir);
    expect(result.engineeringCorpusDir).toBe(engineeringCorpusDir);
    expect(result.rawEnvelopeDir).toBe(rawEnvelopeDir);
    expect(result.engineeringEpisodeFilesWritten).toBe(1);
    expect(result.rawEnvelopeFilesWritten).toBe(1);
    expect(readdirSync(engineeringCorpusDir).some((name) => /^2026-05-14-session-a-[a-f0-9]{8}\.engineering\.txt$/.test(name))).toBe(true);
    expect(readdirSync(rawEnvelopeDir).some((name) => /^2026-05-14-session-a-[a-f0-9]{8}\.envelope\.txt$/.test(name))).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const stateSession = Object.values(state.sessions).find((value) => (value as { session_id?: string }).session_id === "session-a") as {
      source_sha256: string;
      engineering_episode: { transcript_path: string; fingerprint: string };
      raw_envelope: { transcript_path: string; fingerprint: string };
    };
    expect(stateSession.source_sha256).toHaveLength(64);
    expect(stateSession.engineering_episode.transcript_path).toContain(".devbrain-teaching/dream-corpus/codex-engineering/");
    expect(stateSession.raw_envelope.transcript_path).toContain(".devbrain-teaching/debug/envelopes/codex-sessions/");
    expect(state.counters).toMatchObject({
      considered: 1,
      written: 2,
      unchanged: 0,
      skipped: 0,
      malformed: 0,
      redacted: 0,
      truncated: 0,
    });
    expect(state.counters.engineeringLikelyReviewable).toBe(1);
    expect(state.counters.engineeringEvidenceItems).toBeGreaterThan(0);
    expect(state.counters.rawEnvelopeFilesWritten).toBe(1);
    const manifest = JSON.parse(readFileSync(join(result.runDir, "manifest.json"), "utf8"));
    expect(manifest.sessions[0].engineering_episode).toMatchObject({
      episode_version: "engineering-experience-episode-v1",
      source_adapter: "codex-engineering-adapter-v1",
      transcript_path: expect.stringContaining(".devbrain-teaching/dream-corpus/codex-engineering/"),
      fingerprint: expect.any(String),
    });
    expect(manifest.sessions[0].engineering_episode_quality).toMatchObject({
      has_problem: true,
      has_action: true,
      has_result: true,
      has_outcome: true,
      redacted_count: expect.any(Number),
      truncated_count: expect.any(Number),
      malformed_count: expect.any(Number),
      low_signal_count: expect.any(Number),
      likely_engineering_reviewable: true,
    });
    expect(manifest.sessions[0].raw_envelope.transcript_path).toContain(".devbrain-teaching/debug/envelopes/codex-sessions/");
    const report = readFileSync(join(result.runDir, "report.md"), "utf8");
    expect(report).toContain("Engineering episode files written: 1");
    expect(report).toContain("Engineering likely reviewable: 1");
    expect(report).toContain("Engineering evidence items:");
    expect(report).toContain("Raw envelope debug files written: 1");
    expect(existsSync(join(result.runDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(result.runDir, "report.md"))).toBe(true);
    expect(statSync(engineeringCorpusDir).mode & 0o777).toBe(0o700);
    expect(statSync(rawEnvelopeDir).mode & 0o777).toBe(0o700);
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
    expect(statSync(join(result.runDir, "manifest.json")).mode & 0o777).toBe(0o600);
  });

  it("marks goal-only minimal sessions as not dream-reviewable", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const engineeringCorpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-engineering");
    const rawEnvelopeDir = join(dir, ".devbrain-teaching/debug/envelopes/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeSession(join(sessionsDir, "s.jsonl"), "session-a");

    const result = collectCodexSessions({ sessionsDir, engineeringCorpusDir, rawEnvelopeDir, statePath, runRoot, limit: 20, isPathIgnored: () => true, now: () => new Date("2026-05-14T02:00:00.000Z") });
    const manifest = JSON.parse(readFileSync(join(result.runDir, "manifest.json"), "utf8"));

    expect(manifest.sessions[0].engineering_episode_quality.likely_engineering_reviewable).toBe(false);
  });

  it("refuses writes when corpus path is not git ignored", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    writeSession(join(sessionsDir, "s.jsonl"), "session-a");

    expect(() =>
      collectCodexSessions({
        sessionsDir,
        corpusDir: join(dir, "corpus"),
        statePath: join(dir, "state.json"),
        runRoot: join(dir, "runs"),
        limit: 20,
        isPathIgnored: () => false,
      }),
    ).toThrow(/not ignored by git/);
  });

  it("does not rewrite unchanged transcripts", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const engineeringCorpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-engineering");
    const rawEnvelopeDir = join(dir, ".devbrain-teaching/debug/envelopes/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeSession(join(sessionsDir, "s.jsonl"), "session-a");

    collectCodexSessions({ sessionsDir, engineeringCorpusDir, rawEnvelopeDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const fileName = readdirSync(engineeringCorpusDir)[0]!;
    const firstMtime = statSync(join(engineeringCorpusDir, fileName)).mtimeMs;
    const second = collectCodexSessions({ sessionsDir, engineeringCorpusDir, rawEnvelopeDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const secondMtime = statSync(join(engineeringCorpusDir, fileName)).mtimeMs;

    expect(second.unchanged).toBe(2);
    expect(secondMtime).toBe(firstMtime);
  });

  it("tracks sessions with the same session id but different source hashes independently", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const engineeringCorpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-engineering");
    const rawEnvelopeDir = join(dir, ".devbrain-teaching/debug/envelopes/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeSession(join(sessionsDir, "a.jsonl"), "session-a", "First copy.");
    writeSession(join(sessionsDir, "b.jsonl"), "session-a", "Second copy with different hash.");

    const first = collectCodexSessions({ sessionsDir, engineeringCorpusDir, rawEnvelopeDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const second = collectCodexSessions({ sessionsDir, engineeringCorpusDir, rawEnvelopeDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const state = JSON.parse(readFileSync(statePath, "utf8"));

    expect(first.engineeringEpisodeFilesWritten).toBe(2);
    expect(second.unchanged).toBe(4);
    expect(Object.keys(state.sessions)).toHaveLength(2);
  });

  it("migrates legacy single-transcript state into raw envelope shape", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const engineeringCorpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-engineering");
    const rawEnvelopeDir = join(dir, ".devbrain-teaching/debug/envelopes/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    writeRichSession(join(sessionsDir, "s.jsonl"), "session-a");
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        schema_version: 1,
        sessions: {
          legacy: {
            session_id: "session-a",
            source_path: "/old/session.jsonl",
            transcript_path: "/old/transcript.txt",
            fingerprint: "legacy-fingerprint",
            source_sha256: "legacy",
            updated_at: "2026-05-01T00:00:00.000Z",
          },
        },
      }),
    );

    const result = collectCodexSessions({ sessionsDir, engineeringCorpusDir, rawEnvelopeDir, statePath, runRoot, limit: 20, isPathIgnored: () => true });
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const migratedCurrent = Object.values(state.sessions).find((value) => Boolean((value as { engineering_episode?: unknown }).engineering_episode)) as {
      engineering_episode?: unknown;
      raw_envelope?: unknown;
    };
    const migratedLegacy = state.sessions.legacy as {
      transcript_path?: string;
      fingerprint?: string;
      raw_envelope?: { transcript_path: string; fingerprint: string };
    };

    expect(result.engineeringEpisodeFilesWritten).toBe(1);
    expect(migratedCurrent.engineering_episode).toBeDefined();
    expect(migratedCurrent.raw_envelope).toBeDefined();
    expect(migratedLegacy.transcript_path).toBeUndefined();
    expect(migratedLegacy.fingerprint).toBeUndefined();
    expect(migratedLegacy.raw_envelope).toEqual({
      transcript_path: "/old/transcript.txt",
      fingerprint: "legacy-fingerprint",
    });
  });

  it("does not write state, reports, or corpus files when no sessions exist", () => {
    const dir = root();
    const sessionsDir = join(dir, "sessions");
    const corpusDir = join(dir, ".devbrain-teaching/dream-corpus/codex-sessions");
    const statePath = join(dir, ".devbrain-teaching/state/codex-sessions.json");
    const runRoot = join(dir, ".devbrain-teaching/runs");
    const oldTranscript = join(corpusDir, "old.txt");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(corpusDir, { recursive: true });
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(oldTranscript, "old transcript");
    writeFileSync(statePath, JSON.stringify({ old: true }));
    const oldTranscriptMtime = statSync(oldTranscript).mtimeMs;
    const oldState = readFileSync(statePath, "utf8");

    expect(() =>
      collectCodexSessions({
        sessionsDir,
        corpusDir,
        statePath,
        runRoot,
        limit: 20,
        isPathIgnored: () => true,
      }),
    ).toThrow(/no codex session files/i);

    expect(readFileSync(oldTranscript, "utf8")).toBe("old transcript");
    expect(statSync(oldTranscript).mtimeMs).toBe(oldTranscriptMtime);
    expect(readFileSync(statePath, "utf8")).toBe(oldState);
    expect(existsSync(runRoot)).toBe(false);
  });

  it("keeps generated corpus, state, and run artifacts ignored by git", () => {
    for (const path of [
      ".devbrain-teaching/dream-corpus/codex-engineering/example.engineering.txt",
      ".devbrain-teaching/debug/envelopes/codex-sessions/example.envelope.txt",
      ".devbrain-teaching/state/codex-sessions.json",
      ".devbrain-teaching/runs/example/manifest.json",
    ]) {
      const result = spawnSync("git", ["check-ignore", "-q", "--no-index", "--", path], {
        cwd: process.cwd(),
      });
      expect(result.status).toBe(0);
    }
  });
});
