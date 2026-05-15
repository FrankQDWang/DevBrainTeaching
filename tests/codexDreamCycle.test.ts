import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodexDreamCycle } from "../src/codexDreamCycle.js";
import type { GbrainRunner } from "../src/gbrainClient.js";

function brainDir(): string {
  return mkdtempSync(join(tmpdir(), "codex-dream-brain-"));
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
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run`);
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
      collect: () => ({ corpusDir: "/corpus", runDir, considered: 0, written: 0, unchanged: 0, skipped: 0 }),
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
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
      runner,
      corpusDir: "/corpus",
      writeReport: () => undefined,
    });

    expect(calls.map((args) => args.join(" "))).toContain(`dream --dir ${dir} --dry-run`);
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
      collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
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
        collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
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
        collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
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
        collect: () => ({ corpusDir: "/corpus", runDir: "/run", considered: 0, written: 0, unchanged: 0, skipped: 0 }),
        runner,
        corpusDir: "/corpus",
        writeReport: () => undefined,
      }),
    ).toThrow(/not ready/);
  });
});
