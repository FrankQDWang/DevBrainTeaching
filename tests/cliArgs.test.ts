import { describe, expect, it } from "bun:test";

import { parseCodexIngestArgs, parseLimit } from "../src/cliArgs.js";

describe("codex ingest CLI args", () => {
  it("defaults to a safe latest-session slice", () => {
    expect(parseCodexIngestArgs([]).limit).toBe(20);
  });

  it("rejects invalid limits instead of risking full import", () => {
    for (const value of ["0", "-1", "abc", "100000"]) {
      expect(() => parseLimit(value)).toThrow(/Invalid --limit/);
    }
  });

  it("accepts only bounded positive integer limits", () => {
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("20")).toBe(20);
    expect(() => parseLimit("21")).toThrow(/Invalid --limit/);
  });
});
