import { describe, expect, it } from "bun:test";

import { isGbrainCallable } from "../src/gbrainClient.js";

describe("gbrain boundary", () => {
  it("keeps gbrain behind a callable CLI boundary", () => {
    expect(typeof isGbrainCallable()).toBe("boolean");
  });
});

