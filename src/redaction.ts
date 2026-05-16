const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /npm_[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]+/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk_live_[A-Za-z0-9_-]{20,}/g,
  /AIza[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*=\S+/gi,
  /[a-z]+:\/\/[^:\s]+:[^@\s]+@/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
];

export const redactionVersion = "devbrain-redaction-v1";

export interface RedactionResult {
  text: string;
  count: number;
}

export interface BoundTextResult {
  text: string;
  truncated: boolean;
}

export function redactText(value: string): RedactionResult {
  let text = value;
  let count = 0;
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, () => {
      count += 1;
      return "[REDACTED_SECRET]";
    });
  }
  return { text, count };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactLocalPaths(value: string, home = process.env.HOME): RedactionResult {
  const redacted = redactText(value);
  if (!home) return redacted;
  const homePattern = new RegExp(escapeRegExp(home), "g");
  let count = redacted.count;
  const text = redacted.text.replace(homePattern, () => {
    count += 1;
    return "$HOME";
  });
  return { text, count };
}

export function boundText(value: string, maxChars: number): BoundTextResult {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: `${value.slice(0, maxChars)}\n[TRUNCATED]`, truncated: true };
}
