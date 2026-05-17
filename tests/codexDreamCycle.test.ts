import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodexDreamCycle } from "../src/codexDreamCycle.js";
import type { CollectCodexSessionsResult } from "../src/codexCollector.js";
import type { GbrainRunner } from "../src/gbrainClient.js";

function brainDir(): string {
  return mkdtempSync(join(tmpdir(), "codex-dream-brain-"));
}

function collectResult(overrides: Partial<CollectCodexSessionsResult> = {}): CollectCodexSessionsResult {
  return {
    corpusDir: "/corpus",
    engineeringCorpusDir: "/corpus",
    rawEnvelopeDir: "/raw",
    runDir: "/run",
    considered: 0,
    written: 0,
    unchanged: 0,
    skipped: 0,
    engineeringEpisodeFilesWritten: 0,
    rawEnvelopeFilesWritten: 0,
    engineeringEvidenceItems: 0,
    engineeringLikelyReviewable: 0,
    engineeringWithProblem: 0,
    engineeringWithAction: 0,
    engineeringWithResult: 0,
    engineeringWithOutcome: 0,
    engineeringRedacted: 0,
    engineeringTruncated: 0,
    engineeringMalformed: 0,
    engineeringLowSignal: 0,
    ...overrides,
  };
}

describe("codex dream cycle", () => {
  it("uses gbrain dry-run when requested", () => {
    const calls: string[][] = [];
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => collectResult(),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run --json`);
  });

  it("writes default cycle report files into the collector run directory", () => {
    const dir = brainDir();
    const runDir = mkdtempSync(join(tmpdir(), "codex-dream-cycle-run-"));
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => collectResult({ runDir }),
      runner,
      corpusDir: "/corpus",
    });

    const jsonPath = join(runDir, "codex-dream-cycle.json");
    const markdownPath = join(runDir, "codex-dream-cycle.md");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toContain("not zero LLM cost");
  });

  it("does not block dry-run when readiness is incomplete", () => {
    const calls: string[][] = [];
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr: "missing" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => collectResult(),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run --json`);
  });

  it("writes a diagnostic report instead of invoking gbrain when no brain dir is available", () => {
    const calls: string[][] = [];
    let report: unknown;
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr: "missing" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      collect: () => collectResult(),
      runner,
      corpusDir: "/corpus",
      writeReport: (value) => {
        report = value;
      },
    });

    expect(calls.map((args) => args.join(" "))).not.toContain("dream --dry-run");
    expect(JSON.stringify(report)).toContain("brain dir");
    expect(JSON.stringify(report)).toContain("not zero LLM cost");
  });

  it("writes a failure report when gbrain dream fails", () => {
    let report: unknown;
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      if (args[0] === "dream") {
        return { command: ["gbrain", ...args], exitCode: 2, stdout: "partial output", stderr: "dream failed" };
      }
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      runCodexDreamCycle({
        dryRun: true,
        brainDir: dir,
        collect: () => collectResult(),
        runner,
        corpusDir: "/corpus",
        writeReport: (value) => {
          report = value;
        },
      }),
    ).toThrow(/gbrain command failed/);

    expect(JSON.stringify(report)).toContain("dream failed");
    expect(JSON.stringify(report)).toContain("partial output");
    expect(JSON.stringify(report)).toContain('"gbrain_exit_code":2');
  });

  it("redacts and bounds gbrain failure report fields", () => {
    let report: unknown;
    const dir = brainDir();
    const secret = `OPENAI_API_KEY=sk-${"a".repeat(80)}`;
    const huge = `${secret}\n${"x".repeat(6000)}`;
    const runner: GbrainRunner = (args) => {
      if (args[0] === "dream") {
        return { command: ["gbrain", ...args], exitCode: 2, stdout: huge, stderr: huge };
      }
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      }
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") {
        return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      runCodexDreamCycle({
        dryRun: true,
        brainDir: dir,
        collect: () => collectResult(),
        runner,
        corpusDir: "/corpus",
        writeReport: (value) => {
          report = value;
        },
      }),
    ).toThrow(/\[REDACTED_SECRET\]/);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("OPENAI_API_KEY");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("x".repeat(5000));
    expect(serialized).toContain("[REDACTED_SECRET]");
    expect(serialized).toContain("[TRUNCATED]");
  });

  it("blocks full dream runs when readiness is incomplete", () => {
    const runner: GbrainRunner = (args) => {
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get") return { command: ["gbrain", ...args], exitCode: 1, stdout: "", stderr: "missing" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      runCodexDreamCycle({
        dryRun: false,
        collect: () => collectResult(),
        runner,
        corpusDir: "/corpus",
        writeReport: () => undefined,
      }),
    ).toThrow(/not ready/);
  });

  it("parses JSON dry-run diagnostics and distinguishes conservative gbrain verdicts", () => {
    let report: unknown;
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      if (args[0] === "dream") {
        return {
          command: ["gbrain", ...args],
          exitCode: 0,
          stdout: JSON.stringify({ phase: "synthesize", dry_run: true, transcripts_considered: 47, transcripts_selected: 0 }),
          stderr: "",
        };
      }
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => collectResult({ engineeringLikelyReviewable: 2, engineeringWithAction: 2, engineeringWithResult: 2 }),
      runner,
      writeReport: (value) => {
        report = value;
      },
    });

    expect(JSON.stringify(report)).toContain('"selected_count":0');
    expect(JSON.stringify(report)).toContain("gbrain verdict remains conservative");
    expect(JSON.stringify(report)).toContain("--json");
  });

  it("falls back to plain dry-run when JSON diagnostics are unsupported", () => {
    const calls: string[][] = [];
    let report: unknown;
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "dream" && args.includes("--json")) return { command: ["gbrain", ...args], exitCode: 2, stdout: "", stderr: "unknown flag: --json" };
      if (args[0] === "dream") return { command: ["gbrain", ...args], exitCode: 0, stdout: "plain dry run", stderr: "" };
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({
      dryRun: true,
      brainDir: dir,
      collect: () => collectResult(),
      runner,
      writeReport: (value) => {
        report = value;
      },
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run --json`);
    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run`);
    expect(JSON.stringify(report)).toContain('"available":false');
    expect(JSON.stringify(report)).toContain("JSON diagnostics were unavailable");
  });

  it("does not hide a real JSON dry-run failure just because the error mentions --json", () => {
    const calls: string[][] = [];
    let report: unknown;
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "dream" && args.includes("--json")) {
        return { command: ["gbrain", ...args], exitCode: 2, stdout: "", stderr: "model failed while running --json diagnostics" };
      }
      if (args[0] === "dream") return { command: ["gbrain", ...args], exitCode: 0, stdout: "plain dry run", stderr: "" };
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      runCodexDreamCycle({
        dryRun: true,
        brainDir: dir,
        collect: () => collectResult(),
        runner,
        writeReport: (value) => {
          report = value;
        },
      }),
    ).toThrow(/model failed while running --json diagnostics/);

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run --json`);
    expect(calls.map((args) => args.join(" "))).not.toContain(`dream --dir ${dir} --dry-run`);
    expect(JSON.stringify(report)).toContain("model failed while running --json diagnostics");
  });

  it("reports plain dry-run args when JSON fallback succeeds in detection but plain dry-run fails", () => {
    const calls: string[][] = [];
    let report: unknown;
    const dir = brainDir();
    const runner: GbrainRunner = (args) => {
      calls.push(args);
      if (args[0] === "dream" && args.includes("--json")) {
        return { command: ["gbrain", ...args], exitCode: 2, stdout: "", stderr: "unknown flag: --json" };
      }
      if (args[0] === "dream") {
        return { command: ["gbrain", ...args], exitCode: 3, stdout: "plain partial", stderr: "plain dry-run failed" };
      }
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() =>
      runCodexDreamCycle({
        dryRun: true,
        brainDir: dir,
        collect: () => collectResult(),
        runner,
        writeReport: (value) => {
          report = value;
        },
      }),
    ).toThrow(/plain dry-run failed/);

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run --json`);
    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run`);
    expect(JSON.stringify(report)).toContain(`"gbrain_args":["dream","--dir","${dir}","--dry-run"]`);
    expect(JSON.stringify(report)).not.toContain(`"gbrain_args":["dream","--dir","${dir}","--dry-run","--json"]`);
    expect(JSON.stringify(report)).toContain("plain dry-run failed");
  });

  it("uses private owner-only writes for default cycle reports", () => {
    const dir = brainDir();
    const runDir = mkdtempSync(join(tmpdir(), "codex-dream-cycle-private-"));
    writeFileSync(join(runDir, "codex-dream-cycle.md.tmp-stale"), "stale");
    const runner: GbrainRunner = (args) => {
      if (args[0] === "dream") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ transcripts_selected: 1 }), stderr: "" };
      if (args[0] === "--version") return { command: ["gbrain", ...args], exitCode: 0, stdout: "gbrain 0.33.1.0\n", stderr: "" };
      if (args.join(" ") === "sources list --json") return { command: ["gbrain", ...args], exitCode: 0, stdout: JSON.stringify({ sources: [] }), stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.session_corpus_dir") return { command: ["gbrain", ...args], exitCode: 0, stdout: "/corpus\n", stderr: "" };
      if (args[0] === "config" && args[1] === "get" && args[2] === "dream.synthesize.enabled") return { command: ["gbrain", ...args], exitCode: 0, stdout: "true\n", stderr: "" };
      return { command: ["gbrain", ...args], exitCode: 0, stdout: "", stderr: "" };
    };

    runCodexDreamCycle({ dryRun: true, brainDir: dir, collect: () => collectResult({ runDir }), runner });

    expect(statSync(join(runDir, "codex-dream-cycle.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(runDir, "codex-dream-cycle.md")).mode & 0o777).toBe(0o600);
  });
});
