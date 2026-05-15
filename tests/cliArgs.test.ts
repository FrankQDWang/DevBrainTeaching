import { describe, expect, it } from "bun:test";

import { parseCodexCollectArgs, parseGbrainV5InitArgs, parseJinaV5ServiceArgs, parseLimit } from "../src/cliArgs.js";

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

describe("gbrain v5 init CLI args", () => {
  it("parses dry-run", () => {
    expect(parseGbrainV5InitArgs(["--dry-run"])).toEqual({ dryRun: true });
    expect(parseGbrainV5InitArgs([])).toEqual({ dryRun: false });
  });

  it("rejects unknown init args", () => {
    expect(() => parseGbrainV5InitArgs(["--force"])).toThrow(/Unknown gbrain v5 init argument/);
  });
});

describe("jina v5 service CLI args", () => {
  it("defaults to status and accepts explicit service actions", () => {
    expect(parseJinaV5ServiceArgs([])).toEqual({ action: "status" });
    expect(parseJinaV5ServiceArgs(["install"])).toEqual({ action: "install" });
    expect(parseJinaV5ServiceArgs(["uninstall"])).toEqual({ action: "uninstall" });
    expect(parseJinaV5ServiceArgs(["restart"])).toEqual({ action: "restart" });
  });

  it("rejects unknown service actions", () => {
    expect(() => parseJinaV5ServiceArgs(["delete"])).toThrow(/Unknown jina v5 service action/);
    expect(() => parseJinaV5ServiceArgs(["status", "extra"])).toThrow(/Unknown jina v5 service argument/);
  });
});
