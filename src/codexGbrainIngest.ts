import { spawnSync } from "node:child_process";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { parseCodexSessionJsonl } from "./codexSessionParser.js";
import { renderCodexManifest, renderCodexTranscript, transcriptFilename } from "./codexTranscriptWriter.js";
import {
  createGbrainClient,
  GbrainCommandError,
  type CommandResult,
  type GbrainRunner,
} from "./gbrainClient.js";

const sourceName = "codex-sessions";
const defaultSessionsDir = "/Users/frankqdwang/.codex/sessions";

const reportSecretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|JINA_API_KEY)=\S+/g,
  /https?:\/\/[^:\s]+:[^@\s]+@/g,
];

export const defaultVerificationQueries = [
  {
    question: "What recurring mistakes or failure modes appeared in recent Codex work?",
    query: "Errors Root Causes failed",
  },
  {
    question: "Which verification commands are recurring in recent Codex sessions?",
    query: "Verification bun test",
  },
  {
    question: "What reusable development lessons should be retained from recent Codex work?",
    query: "Reusable Lessons",
  },
  {
    question: "Which gbrain or embedding setup decisions were made recently?",
    query: "gbrain embedding Jina",
  },
  {
    question: "What project outcomes were completed in recent Codex sessions?",
    query: "Outcome verified",
  },
];

export interface CodexGbrainIngestOptions {
  sessionsDir?: string;
  outputRoot?: string;
  sourceRoot?: string;
  limit?: number;
  runner?: GbrainRunner;
  isPathIgnored?: (path: string) => boolean;
  now?: () => Date;
}

export interface CodexGbrainIngestResult {
  runDir: string;
  sourceRoot: string;
  transcriptsWritten: number;
}

interface VerificationRow {
  question: string;
  output: string;
  usable: boolean;
  notes: string;
  follow_up: string | null;
}

interface SourceRecord {
  id?: string;
  name?: string;
  type?: string;
  local_path?: string;
  path?: string;
  federated?: boolean;
}

export function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error(`Invalid --limit ${String(limit)}; expected an integer between 1 and 20.`);
  }
  return limit;
}

function redactForReport(value: string): string {
  let redacted = value;
  for (const pattern of reportSecretPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

function collectJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectJsonlFiles(path));
    } else if (stat.isFile() && path.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function readFileHead(path: string, bytes = 64 * 1024): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const readBytes = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, readBytes).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function sessionSortTimestamp(path: string): number {
  const mtimeMs = statSync(path).mtimeMs;
  const lines = readFileHead(path).split(/\r?\n/).slice(0, 50);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { timestamp?: unknown; payload?: { timestamp?: unknown } };
      if (typeof event.payload?.timestamp === "string") {
        const parsed = Date.parse(event.payload.timestamp);
        if (Number.isFinite(parsed)) return parsed;
      }
      if (typeof event.timestamp === "string") {
        const parsed = Date.parse(event.timestamp);
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch {
      continue;
    }
  }
  return mtimeMs;
}

function latestSessionFiles(dir: string, limit: number): string[] {
  return collectJsonlFiles(dir)
    .map((path) => ({ path, sortKey: sessionSortTimestamp(path) }))
    .sort((a, b) => b.sortKey - a.sortKey || b.path.localeCompare(a.path))
    .slice(0, limit)
    .reverse()
    .map((item) => item.path);
}

function defaultIsPathIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", path], { encoding: "utf8" });
  return result.status === 0;
}

function ensureIgnored(path: string, isPathIgnored: (path: string) => boolean): void {
  if (!isPathIgnored(path)) {
    throw new Error(
      `Refusing to write private Codex transcripts because ${path} is not ignored by git. ` +
        "Add .devbrain-teaching/gbrain-sources/ to .gitignore first.",
    );
  }
}

function assertInsideDir(parent: string, child: string): void {
  const root = resolve(parent);
  const target = resolve(child);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refusing to write transcript outside transcript dir: ${target}`);
  }
}

function classifyQueryOutput(output: string): Omit<VerificationRow, "question" | "output"> {
  const text = output.trim();
  if (!text) {
    return { usable: false, notes: "Empty output.", follow_up: "Improve transcript quality or query coverage." };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return {
          usable: false,
          notes: "Source-scoped query returned no results.",
          follow_up: "Inspect transcript sections and source sync state.",
        };
      }
      const wrongSource = parsed.some(
        (item) => item && typeof item === "object" && (item as { source_id?: unknown }).source_id !== sourceName,
      );
      if (wrongSource) {
        return {
          usable: false,
          notes: "Query returned results outside codex-sessions.",
          follow_up: "Check source-scoped query invocation.",
        };
      }
      return {
        usable: true,
        notes: "Non-empty source-scoped result from codex-sessions.",
        follow_up: null,
      };
    }
  } catch {
    // Plain-text CLI output is still supported for older gbrain surfaces.
  }
  if (/no results|not found|nothing/i.test(text)) {
    return {
      usable: false,
      notes: "Query appears to have no useful result.",
      follow_up: "Inspect transcript sections and source sync state.",
    };
  }
  if (text.length < 20) {
    return { usable: false, notes: "Output is too short to be useful.", follow_up: "Review gbrain query output." };
  }
  return {
    usable: true,
    notes: "Non-empty source-scoped result; needs human review for semantic usefulness.",
    follow_up: null,
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof GbrainCommandError) {
    return {
      name: error.name,
      message: redactForReport(error.message),
      command: error.result.command,
      exit_code: error.result.exitCode,
      stdout: redactForReport(error.result.stdout),
      stderr: redactForReport(error.result.stderr),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: redactForReport(error.message) };
  }
  return { message: redactForReport(String(error)) };
}

function renderVerificationMarkdown(rows: VerificationRow[], status: "passed" | "failed"): string {
  const passCount = rows.filter((row) => row.usable).length;
  const lines = [
    "# Codex Sessions Gbrain Verification",
    "",
    `Status: ${status}`,
    `Usable answers: ${passCount}/${rows.length}`,
    "",
  ];
  for (const row of rows) {
    lines.push(`## ${row.question}`);
    lines.push(`- Usable: ${row.usable ? "yes" : "no"}`);
    lines.push(`- Notes: ${row.notes}`);
    if (row.follow_up) lines.push(`- Follow-up: ${row.follow_up}`);
    lines.push("");
    lines.push("```text");
    lines.push(redactForReport(row.output.trim()));
    lines.push("```");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function renderFailureMarkdown(stage: string, error: unknown): string {
  return `# Codex Sessions Gbrain Verification

Status: failed
Stage: ${stage}

\`\`\`json
${JSON.stringify(serializeError(error), null, 2)}
\`\`\`
`;
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof GbrainCommandError)) return false;
  return /already exists/i.test(`${error.result.stderr}\n${error.result.stdout}`);
}

function assertNoSoftGbrainFailure(result: CommandResult): void {
  const output = `${result.stdout}\n${result.stderr}`;
  if (/Full sync blocked|Import completed with \d+ failure|failed to parse|sync\.last_commit NOT advanced/i.test(output)) {
    throw new Error(redactForReport(output.trim()));
  }
}

function readSources(client: ReturnType<typeof createGbrainClient>): SourceRecord[] {
  const result = client.run(["sources", "list", "--json"]);
  const parsed = JSON.parse(result.stdout) as unknown;
  if (Array.isArray(parsed)) return parsed as SourceRecord[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { sources?: unknown }).sources)) {
    return (parsed as { sources: SourceRecord[] }).sources;
  }
  throw new Error("Unexpected gbrain sources list --json schema.");
}

function findSource(client: ReturnType<typeof createGbrainClient>): SourceRecord | undefined {
  return readSources(client).find((source) => source.id === sourceName || source.name === sourceName);
}

function validateExistingSource(source: SourceRecord | undefined, sourceRoot: string): void {
  if (!source) throw new Error(`gbrain source ${sourceName} already exists but could not be inspected.`);
  const localPath = source.local_path ?? source.path;
  if (!localPath) throw new Error(`Existing ${sourceName} source has no local_path.`);
  if (resolve(localPath) !== resolve(sourceRoot)) {
    throw new Error(`Existing ${sourceName} source local_path does not match ${sourceRoot}: ${localPath}`);
  }
  if (source.type !== undefined && source.type !== "local") {
    throw new Error(`Existing ${sourceName} source is not local: ${source.type}`);
  }
  if (source.federated !== undefined && source.federated !== false) {
    throw new Error(`Existing ${sourceName} source must be non-federated.`);
  }
}

function ensureCodexSource(client: ReturnType<typeof createGbrainClient>, sourceRoot: string): void {
  const existing = findSource(client);
  if (existing) {
    validateExistingSource(existing, sourceRoot);
    return;
  }

  try {
    client.run(["sources", "add", sourceName, "--path", sourceRoot, "--no-federated"]);
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    validateExistingSource(findSource(client), sourceRoot);
  }
}

function replaceTranscriptSnapshot(sourceRoot: string, transcriptDir: string, tempTranscriptDir: string, runId: string): void {
  mkdirSync(sourceRoot, { recursive: true });
  const backupDir = join(sourceRoot, `.transcripts.backup-${runId}`);
  rmSync(backupDir, { recursive: true, force: true });

  try {
    if (existsSync(transcriptDir)) {
      renameSync(transcriptDir, backupDir);
    }
    renameSync(tempTranscriptDir, transcriptDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    rmSync(transcriptDir, { recursive: true, force: true });
    if (existsSync(backupDir)) {
      renameSync(backupDir, transcriptDir);
    }
    throw error;
  }
}

function runGit(args: string[], cwd?: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

function ensureSourceGitRepo(sourceRoot: string): void {
  const result = spawnSync("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status === 0 && resolve(result.stdout.trim()) === resolve(sourceRoot)) return;
  runGit(["init", "-b", "main", sourceRoot]);
}

function commitSourceSnapshot(sourceRoot: string, runId: string): void {
  runGit(["-C", sourceRoot, "add", "-A"]);
  runGit([
    "-C",
    sourceRoot,
    "-c",
    "user.name=DevBrain Teaching",
    "-c",
    "user.email=devbrain-teaching@local",
    "commit",
    "--allow-empty",
    "-m",
    `Refresh codex session transcripts ${runId}`,
  ]);
}

function writeFailureArtifacts(
  verificationJsonPath: string,
  verificationMarkdownPath: string,
  generatedAt: string,
  stage: string,
  error: unknown,
): void {
  writeFileSync(
    verificationJsonPath,
    `${JSON.stringify(
      {
        generated_at: generatedAt,
        status: "failed",
        stage,
        error: serializeError(error),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(verificationMarkdownPath, renderFailureMarkdown(stage, error));
}

export function runCodexGbrainIngest(options: CodexGbrainIngestOptions = {}): CodexGbrainIngestResult {
  const limit = validateLimit(options.limit ?? 20);
  const sessionsDir = options.sessionsDir ?? defaultSessionsDir;
  const sourceRoot = resolve(options.sourceRoot ?? ".devbrain-teaching/gbrain-sources/codex-sessions");
  const outputRoot = resolve(options.outputRoot ?? ".devbrain-teaching/runs");
  const now = options.now ?? (() => new Date());
  const isPathIgnored = options.isPathIgnored ?? defaultIsPathIgnored;
  const generatedAt = now().toISOString();
  const runId = generatedAt.replace(/[:.]/g, "-");
  const runDir = join(outputRoot, runId, sourceName);
  const transcriptDir = join(sourceRoot, "transcripts");
  const tempTranscriptDir = join(sourceRoot, `.transcripts.tmp-${runId}`);
  const manifestPath = join(runDir, "manifest.json");
  const verificationJsonPath = join(runDir, "verification.json");
  const verificationMarkdownPath = join(runDir, "verification.md");

  ensureIgnored(join(sourceRoot, "transcripts", "example.md"), isPathIgnored);

  const files = latestSessionFiles(sessionsDir, limit);
  if (files.length === 0) {
    throw new Error(`No Codex session JSONL files found under ${sessionsDir}.`);
  }

  mkdirSync(runDir, { recursive: true });
  mkdirSync(dirname(tempTranscriptDir), { recursive: true });
  rmSync(tempTranscriptDir, { recursive: true, force: true });
  mkdirSync(tempTranscriptDir, { recursive: true });

  const sessions = files.map((sourcePath) =>
    parseCodexSessionJsonl({
      sourcePath,
      content: readFileSync(sourcePath, "utf8"),
    }),
  );

  for (const session of sessions) {
    const outputPath = resolve(tempTranscriptDir, transcriptFilename(session));
    assertInsideDir(tempTranscriptDir, outputPath);
    writeFileSync(outputPath, renderCodexTranscript(session));
  }

  replaceTranscriptSnapshot(sourceRoot, transcriptDir, tempTranscriptDir, runId);
  writeFileSync(manifestPath, renderCodexManifest(sessions, generatedAt));

  const client = createGbrainClient(options.runner);
  try {
    ensureSourceGitRepo(sourceRoot);
    commitSourceSnapshot(sourceRoot, runId);
    client.run(["--version"]);
    ensureCodexSource(client, sourceRoot);
    assertNoSoftGbrainFailure(client.run(["sync", "--source", sourceName, "--no-pull"]));
    assertNoSoftGbrainFailure(client.run(["embed", "--stale"]));
  } catch (error) {
    writeFailureArtifacts(verificationJsonPath, verificationMarkdownPath, generatedAt, "gbrain-sync-embed", error);
    throw error;
  }

  let rows: VerificationRow[];
  try {
    rows = defaultVerificationQueries.map(({ question, query }) => {
      const result: CommandResult = client.run([
        "call",
        "--source",
        sourceName,
        "search",
        JSON.stringify({ query, limit: 3 }),
      ]);
      return { question, output: redactForReport(result.stdout), ...classifyQueryOutput(result.stdout) };
    });
  } catch (error) {
    writeFailureArtifacts(verificationJsonPath, verificationMarkdownPath, generatedAt, "verification-query", error);
    throw error;
  }

  const passCount = rows.filter((row) => row.usable).length;
  const passed = passCount >= 3;
  writeFileSync(
    verificationJsonPath,
    `${JSON.stringify(
      {
        generated_at: generatedAt,
        status: passed ? "passed" : "failed",
        pass_count: passCount,
        passed,
        verification: rows,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(verificationMarkdownPath, renderVerificationMarkdown(rows, passed ? "passed" : "failed"));

  if (!passed) {
    throw new Error(`Verification failed: only ${passCount}/5 answers were usable.`);
  }

  return { runDir, sourceRoot, transcriptsWritten: sessions.length };
}
