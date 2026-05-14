import { describe, expect, it } from "bun:test";

import {
  createGbrainClient,
  GbrainCommandError,
  isGbrainCallable,
} from "../src/gbrainClient.js";

describe("gbrain boundary", () => {
  it("keeps gbrain behind a callable CLI boundary", () => {
    expect(typeof isGbrainCallable()).toBe("boolean");
  });

  it("throws structured errors for failed commands", () => {
    const client = createGbrainClient((args) => ({
      command: ["gbrain", ...args],
      exitCode: 2,
      stdout: "",
      stderr: "boom",
    }));

    expect(() => client.run(["sync"])).toThrow(GbrainCommandError);
  });

  it("parses JSON output through the CLI boundary", () => {
    const client = createGbrainClient((args) => ({
      command: ["gbrain", ...args],
      exitCode: 0,
      stdout: JSON.stringify({ args }),
      stderr: "",
    }));

    expect(client.callTool<{ args: string[] }>(["sources", "list", "--json"])).toEqual({
      args: ["sources", "list", "--json"],
    });
  });
});
