import { describe, expect, it } from "bun:test";

import { boundText, redactText } from "../src/redaction.js";

describe("redaction", () => {
  it("redacts common secrets", () => {
    const input = [
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      "Authorization: Bearer abc.def.ghi",
      "github_pat_1234567890abcdefghijklmnopqrstuvwxyz",
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "xoxb-123-456-secret",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456",
      "JINA_API_KEY=jina_abcdefghijklmnopqrstuvwxyz123456",
      "STRIPE_SECRET_KEY=stripe-live-key-redacted-example",
      "GOOGLE_API_KEY=AIzaabcdefghijklmnopqrstuvwxyz123456",
      "GITLAB_TOKEN=glpat-abcdefghijklmnopqrstuvwxyz",
      "NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz",
      "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
      "AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz1234567890",
      "DATABASE_URL=postgres://user:pass@example.com/db",
      "REDIS_URL=redis://user:pass@example.com:6379/0",
      "-----BEGIN OPENSSH PRIVATE KEY-----\r\nsecret\r\n-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    const result = redactText(input);
    expect(result.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(result.text).not.toContain("abc.def.ghi");
    expect(result.text).not.toContain("github_pat_");
    expect(result.text).not.toContain("ghp_");
    expect(result.text).not.toContain("xoxb-");
    expect(result.text).not.toContain("sk-ant-");
    expect(result.text).not.toContain("jina_");
    expect(result.text).not.toContain("sk_live_");
    expect(result.text).not.toContain("AIza");
    expect(result.text).not.toContain("glpat-");
    expect(result.text).not.toContain("npm_");
    expect(result.text).not.toContain("AKIA");
    expect(result.text).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(result.text).not.toContain("user:pass@");
    expect(result.text).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(result.count).toBeGreaterThanOrEqual(15);
  });

  it("bounds text and reports truncation", () => {
    const result = boundText("abcdef", 3);
    expect(result.text).toBe("abc\n[TRUNCATED]");
    expect(result.truncated).toBe(true);
  });
});
