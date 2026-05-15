import { describe, expect, it } from "bun:test";

import { parseCodexCollectArgs, parseLimit } from "../src/cliArgs.js";

describe("codex collect CLI args", () => {
  it("defaults to a safe latest-session slice", () => {
    expect(parseCodexCollectArgs([])).toEqual({ limit: 20, dryRun: false });
  });

  it("rejects invalid limits instead of risking full import", () => {
    for (const value of ["0", "-1", "abc", "100000"]) {
      expect(() => parseLimit(value)).toThrow(/Invalid --limit/);
    }
    expect(() => parseCodexCollectArgs(["--limit"])).toThrow(/Invalid --limit/);
  });

  it("accepts only bounded positive integer limits", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("100")).toBe(100);
    expect(() => parseLimit("101")).toThrow(/Invalid --limit/);
  });

  it("parses dry-run and brain-dir options", () => {
    expect(parseCodexCollectArgs(["--limit", "5", "--dry-run", "--brain-dir", "/tmp/brain"])).toEqual({
      limit: 5,
      dryRun: true,
      brainDir: "/tmp/brain",
    });
  });
});
