import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";

import type { CommandResult, GbrainRunner } from "./gbrainClient.js";
import type { JinaV5ServiceAction } from "./cliArgs.js";

export interface GbrainV5Runtime {
  cwd: string;
  root: string;
  gbrainHome: string;
  configPath: string;
  modelDir: string;
  postgres: {
    containerName: string;
    host: string;
    port: number;
    database: string;
    user: string;
  };
  embedding: {
    modelId: string;
    model: string;
    dimensions: number;
    host: string;
    port: number;
  };
}

export interface BuildEnvOptions {
  postgresPassword: string;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface GbrainV5Command {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  redactedArgs: string[];
  redactedEnv: NodeJS.ProcessEnv;
}

export interface GbrainV5EnvDescription {
  runtime: {
    cwd: string;
    root: string;
    gbrainHome: string;
    configPath: string;
    modelDir: string;
    postgres: GbrainV5Runtime["postgres"];
    embedding: GbrainV5Runtime["embedding"];
  };
  env: {
    GBRAIN_HOME: string;
    LITELLM_BASE_URL: string;
    GBRAIN_EMBEDDING_MODEL: string;
    GBRAIN_EMBEDDING_DIMENSIONS: string;
    JINA_V5_EMBEDDING_MODEL: string;
    JINA_V5_EMBEDDING_DIMENSIONS: string;
  };
}

export type RuntimeRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => CommandResult;
export type ConfigFileReader = (path: string) => string | null;

export interface GbrainV5ReadinessReport {
  ready: boolean;
  runtime: GbrainV5Runtime;
  checks: Array<{ name: string; ok: boolean; message: string }>;
}

export interface JinaV5ServiceSpec {
  label: string;
  domain: string;
  serviceTarget: string;
  plistPath: string;
  installedPlistPath: string;
  pythonPath: string;
  scriptPath: string;
  workingDirectory: string;
  stdoutPath: string;
  stderrPath: string;
  env: Record<string, string>;
}

export function repoLocalGbrainHome(cwd = process.cwd()): string {
  return resolve(cwd, ".devbrain-teaching/gbrain-v5");
}

export function defaultGbrainV5Runtime(options: { cwd?: string } = {}): GbrainV5Runtime {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(cwd, ".devbrain-teaching");

  return {
    cwd,
    root,
    gbrainHome: resolve(root, "gbrain-v5"),
    configPath: resolve(root, "gbrain-v5/.gbrain/config.json"),
    modelDir: resolve(root, "models/jina-v5-text-small-mlx"),
    postgres: {
      containerName: "devbrainteaching-gbrain-v5-postgres",
      host: "127.0.0.1",
      port: 55433,
      database: "devbrainteaching_gbrain_v5",
      user: "gbrain_v5",
    },
    embedding: {
      modelId: "jinaai/jina-embeddings-v5-text-small-mlx",
      model: "jina-embeddings-v5-text-small",
      dimensions: 1024,
      host: "127.0.0.1",
      port: 8797,
    },
  };
}

export function gbrainV5DatabaseUrl(runtime: GbrainV5Runtime, password: string): string {
  if (!password) throw new Error("Missing GBRAIN_V5_POSTGRES_PASSWORD.");
  return `postgresql://${runtime.postgres.user}:${encodeURIComponent(password)}@${runtime.postgres.host}:${runtime.postgres.port}/${runtime.postgres.database}`;
}

export function redactedGbrainV5DatabaseUrl(runtime: GbrainV5Runtime): string {
  return `postgresql://${runtime.postgres.user}:***@${runtime.postgres.host}:${runtime.postgres.port}/${runtime.postgres.database}`;
}

export function buildGbrainV5BaseEnv(runtime: GbrainV5Runtime, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(cleanEnv)) {
    if (
      key === "DATABASE_URL" ||
      key === "GBRAIN_DATABASE_URL" ||
      key === "GBRAIN_HOME" ||
      key === "LITELLM_BASE_URL" ||
      key === "GBRAIN_EXPANSION_MODEL" ||
      key === "GBRAIN_REMOTE_CLIENT_SECRET" ||
      key.startsWith("GBRAIN_EMBEDDING_") ||
      key.startsWith("GBRAIN_CHAT_")
    ) {
      delete cleanEnv[key];
    }
  }

  return {
    ...cleanEnv,
    GBRAIN_HOME: runtime.gbrainHome,
    LITELLM_BASE_URL: `http://${runtime.embedding.host}:${runtime.embedding.port}/v1`,
    GBRAIN_EMBEDDING_MODEL: `litellm:${runtime.embedding.model}`,
    GBRAIN_EMBEDDING_DIMENSIONS: String(runtime.embedding.dimensions),
    JINA_V5_EMBEDDING_MODEL: runtime.embedding.model,
    JINA_V5_EMBEDDING_DIMENSIONS: String(runtime.embedding.dimensions),
  };
}

export function buildGbrainV5Env(runtime: GbrainV5Runtime, options: BuildEnvOptions): NodeJS.ProcessEnv {
  return {
    ...buildGbrainV5BaseEnv(runtime, options.baseEnv ?? process.env),
    GBRAIN_DATABASE_URL: gbrainV5DatabaseUrl(runtime, options.postgresPassword),
  };
}

export function describeGbrainV5Env(runtime: GbrainV5Runtime, baseEnv: NodeJS.ProcessEnv = process.env): GbrainV5EnvDescription {
  const env = buildGbrainV5BaseEnv(runtime, baseEnv);
  return {
    runtime: {
      cwd: runtime.cwd,
      root: runtime.root,
      gbrainHome: runtime.gbrainHome,
      configPath: runtime.configPath,
      modelDir: runtime.modelDir,
      postgres: { ...runtime.postgres },
      embedding: { ...runtime.embedding },
    },
    env: {
      GBRAIN_HOME: env.GBRAIN_HOME ?? "",
      LITELLM_BASE_URL: env.LITELLM_BASE_URL ?? "",
      GBRAIN_EMBEDDING_MODEL: env.GBRAIN_EMBEDDING_MODEL ?? "",
      GBRAIN_EMBEDDING_DIMENSIONS: env.GBRAIN_EMBEDDING_DIMENSIONS ?? "",
      JINA_V5_EMBEDDING_MODEL: env.JINA_V5_EMBEDDING_MODEL ?? "",
      JINA_V5_EMBEDDING_DIMENSIONS: env.JINA_V5_EMBEDDING_DIMENSIONS ?? "",
    },
  };
}

export function redactGbrainV5Env(runtime: GbrainV5Runtime, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    GBRAIN_HOME: env.GBRAIN_HOME,
    LITELLM_BASE_URL: env.LITELLM_BASE_URL,
    GBRAIN_EMBEDDING_MODEL: env.GBRAIN_EMBEDDING_MODEL,
    GBRAIN_EMBEDDING_DIMENSIONS: env.GBRAIN_EMBEDDING_DIMENSIONS,
    JINA_V5_EMBEDDING_MODEL: env.JINA_V5_EMBEDDING_MODEL,
    JINA_V5_EMBEDDING_DIMENSIONS: env.JINA_V5_EMBEDDING_DIMENSIONS,
    GBRAIN_DATABASE_URL: redactedGbrainV5DatabaseUrl(runtime),
  };
}

export function createGbrainV5Runner(options: {
  runtime?: GbrainV5Runtime;
  postgresPassword?: string;
  baseEnv?: NodeJS.ProcessEnv;
  runner?: RuntimeRunner;
} = {}): GbrainRunner {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  assertRepoLocalRuntime(runtime);
  const password = options.postgresPassword ?? options.baseEnv?.GBRAIN_V5_POSTGRES_PASSWORD ?? process.env.GBRAIN_V5_POSTGRES_PASSWORD;
  const env = password
    ? buildGbrainV5Env(runtime, { postgresPassword: password, baseEnv: options.baseEnv ?? process.env })
    : buildGbrainV5BaseEnv(runtime, options.baseEnv ?? process.env);
  const command = env.GBRAIN_BIN ?? process.env.GBRAIN_BIN ?? "gbrain";
  const runner = options.runner ?? spawnRuntimeCommand;

  return (args: string[]): CommandResult => runner(command, args, env);
}

export function buildGbrainV5InitCommand(runtime: GbrainV5Runtime, postgresPassword: string): GbrainV5Command {
  const databaseUrl = gbrainV5DatabaseUrl(runtime, postgresPassword);
  const env = buildGbrainV5Env(runtime, { postgresPassword });
  const redactedUrl = redactedGbrainV5DatabaseUrl(runtime);
  const args = [
    "init",
    "--non-interactive",
    "--url",
    databaseUrl,
    "--embedding-model",
    `litellm:${runtime.embedding.model}`,
    "--embedding-dimensions",
    String(runtime.embedding.dimensions),
  ];

  return {
    command: process.env.GBRAIN_BIN ?? "gbrain",
    args,
    env,
    redactedArgs: args.map((arg) => (arg === databaseUrl ? redactedUrl : arg)),
    redactedEnv: redactGbrainV5Env(runtime, env),
  };
}

export const spawnRuntimeCommand: RuntimeRunner = (command, args, env) => {
  const result = spawnSync(command, args, { encoding: "utf8", env });
  return {
    command: [command, ...args],
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

export function jinaV5ServiceSpec(
  runtime: GbrainV5Runtime,
  uid = process.getuid?.() ?? 0,
  homeDir = homedir(),
): JinaV5ServiceSpec {
  const label = "com.devbrainteaching.jina-v5-mlx-server";
  return {
    label,
    domain: `gui/${uid}`,
    serviceTarget: `gui/${uid}/${label}`,
    plistPath: resolve(runtime.root, `state/${label}.plist`),
    installedPlistPath: resolve(homeDir, `Library/LaunchAgents/${label}.plist`),
    pythonPath: resolve(runtime.root, "venv/bin/python"),
    scriptPath: resolve(runtime.cwd, "scripts/jina_v5_mlx_server.py"),
    workingDirectory: runtime.cwd,
    stdoutPath: resolve(runtime.root, "runs/jina-v5-mlx-server.log"),
    stderrPath: resolve(runtime.root, "runs/jina-v5-mlx-server.err.log"),
    env: {
      JINA_V5_DOCUMENT_TASK_TYPE: "retrieval.passage",
      JINA_V5_EMBEDDING_DIMENSIONS: String(runtime.embedding.dimensions),
      JINA_V5_EMBEDDING_MODEL: runtime.embedding.model,
      JINA_V5_MODEL_DIR: runtime.modelDir,
      JINA_V5_MODEL_ID: runtime.embedding.modelId,
      JINA_V5_PROXY_HOST: runtime.embedding.host,
      JINA_V5_PROXY_PORT: String(runtime.embedding.port),
      JINA_V5_QUERY_TASK_TYPE: "retrieval.query",
      JINA_V5_TASK: "retrieval",
    },
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderJinaV5LaunchAgentPlist(spec: JinaV5ServiceSpec): string {
  const envEntries = Object.entries(spec.env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `\t\t<key>${xmlEscape(key)}</key>\n\t\t<string>${xmlEscape(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>EnvironmentVariables</key>
\t<dict>
${envEntries}
\t</dict>
\t<key>KeepAlive</key>
\t<true/>
\t<key>Label</key>
\t<string>${xmlEscape(spec.label)}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${xmlEscape(spec.pythonPath)}</string>
\t\t<string>${xmlEscape(spec.scriptPath)}</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(spec.stderrPath)}</string>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(spec.stdoutPath)}</string>
\t<key>WorkingDirectory</key>
\t<string>${xmlEscape(spec.workingDirectory)}</string>
</dict>
</plist>
`;
}

export function writeJinaV5LaunchAgentPlist(runtime: GbrainV5Runtime, uid?: number): JinaV5ServiceSpec {
  assertRepoLocalRuntime(runtime);
  const spec = jinaV5ServiceSpec(runtime, uid);
  mkdirSync(dirname(spec.plistPath), { recursive: true });
  mkdirSync(dirname(spec.stdoutPath), { recursive: true });
  writeFileSync(spec.plistPath, renderJinaV5LaunchAgentPlist(spec), { mode: 0o600 });
  return spec;
}

export function installJinaV5LaunchAgentPlist(
  runtime: GbrainV5Runtime,
  uid?: number,
  homeDir?: string,
): JinaV5ServiceSpec {
  assertRepoLocalRuntime(runtime);
  const spec = jinaV5ServiceSpec(runtime, uid, homeDir);
  mkdirSync(dirname(spec.plistPath), { recursive: true });
  mkdirSync(dirname(spec.stdoutPath), { recursive: true });
  mkdirSync(dirname(spec.installedPlistPath), { recursive: true });
  writeFileSync(spec.plistPath, renderJinaV5LaunchAgentPlist(spec), { mode: 0o600 });
  copyFileSync(spec.plistPath, spec.installedPlistPath);
  return spec;
}

function runRequired(runner: RuntimeRunner, command: string, args: string[], env: NodeJS.ProcessEnv): CommandResult {
  const result = runner(command, args, env);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} ${args.join(" ")} failed`);
  }
  return result;
}

export function setupJinaV5Venv(options: {
  runtime?: GbrainV5Runtime;
  runner?: RuntimeRunner;
} = {}): CommandResult[] {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  assertRepoLocalRuntime(runtime);
  const runner = options.runner ?? spawnRuntimeCommand;
  const spec = jinaV5ServiceSpec(runtime);
  const env = process.env;

  return [
    runRequired(runner, "python3", ["-m", "venv", resolve(runtime.root, "venv")], env),
    runRequired(runner, spec.pythonPath, ["-m", "pip", "install", "--upgrade", "pip"], env),
    runRequired(runner, spec.pythonPath, ["-m", "pip", "install", "mlx", "tokenizers", "huggingface_hub"], env),
  ];
}

export function runJinaV5ServiceAction(options: {
  action: JinaV5ServiceAction;
  runtime?: GbrainV5Runtime;
  runner?: RuntimeRunner;
  uid?: number;
  homeDir?: string;
}): CommandResult[] {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  assertRepoLocalRuntime(runtime);
  const runner = options.runner ?? spawnRuntimeCommand;
  const env = process.env;
  const results: CommandResult[] = [];

  if (options.action === "plist") {
    writeJinaV5LaunchAgentPlist(runtime, options.uid);
    return results;
  }

  const spec = jinaV5ServiceSpec(runtime, options.uid, options.homeDir);

  const serviceStatus = (): CommandResult => runner("launchctl", ["print", spec.serviceTarget], env);

  if (options.action === "status") {
    results.push(serviceStatus());
    return results;
  }

  if (options.action === "stop") {
    results.push(runner("launchctl", ["bootout", spec.serviceTarget], env));
    return results;
  }

  if (options.action === "uninstall") {
    results.push(runner("launchctl", ["bootout", spec.serviceTarget], env));
    rmSync(spec.installedPlistPath, { force: true });
    return results;
  }

  if (options.action === "start") {
    const status = serviceStatus();
    if (status.exitCode === 0) {
      results.push(runRequired(runner, "launchctl", ["kickstart", "-k", spec.serviceTarget], env));
    } else {
      const installedSpec = installJinaV5LaunchAgentPlist(runtime, options.uid, options.homeDir);
      results.push(runRequired(runner, "launchctl", ["bootstrap", installedSpec.domain, installedSpec.installedPlistPath], env));
    }
    return results;
  }

  if (options.action === "install" || options.action === "restart") {
    const installedSpec = installJinaV5LaunchAgentPlist(runtime, options.uid, options.homeDir);
    const status = serviceStatus();
    if (status.exitCode === 0) {
      results.push(runner("launchctl", ["bootout", spec.serviceTarget], env));
      results.push(runRequired(runner, "sleep", ["1"], env));
    }
    results.push(runRequired(runner, "launchctl", ["bootstrap", installedSpec.domain, installedSpec.installedPlistPath], env));
    return results;
  }

  return results;
}

function assertRepoLocalRuntime(runtime: GbrainV5Runtime): void {
  const root = resolve(runtime.root);
  const home = resolve(runtime.gbrainHome);
  if (root !== resolve(runtime.cwd, ".devbrain-teaching")) {
    throw new Error(`Refusing to use runtime root outside repo .devbrain-teaching: ${runtime.root}`);
  }
  if (!home.startsWith(`${root}${sep}`)) {
    throw new Error(`Refusing to use GBRAIN_HOME outside repo runtime root: ${runtime.gbrainHome}`);
  }
  if (home.includes(`${sep}.gbrain${sep}`) || home.endsWith(`${sep}.gbrain`)) {
    throw new Error(`Refusing to use global-style GBRAIN_HOME: ${runtime.gbrainHome}`);
  }
  if (runtime.embedding.dimensions !== 1024) {
    throw new Error(`Expected v5 embedding dimensions to be 1024, got ${runtime.embedding.dimensions}.`);
  }
}

function dockerPortOwnedByExpectedContainer(output: string, runtime: GbrainV5Runtime): boolean {
  return output.split("\n").some((line) =>
    line.includes(runtime.postgres.containerName) &&
    line.includes(`${runtime.postgres.host}:${runtime.postgres.port}->5432/tcp`),
  );
}

function dockerContainerHealthy(runner: RuntimeRunner, runtime: GbrainV5Runtime): { ok: boolean; message: string } {
  const result = runner("docker", [
    "inspect",
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    runtime.postgres.containerName,
  ], process.env);
  const message = result.stdout.trim() || result.stderr.trim();
  return { ok: result.exitCode === 0 && /^(healthy|running)$/.test(message), message };
}

function defaultReadConfigFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function checkRepoLocalConfigFile(runtime: GbrainV5Runtime, readConfigFile: ConfigFileReader): { ok: boolean; message: string } {
  const raw = readConfigFile(runtime.configPath);
  if (!raw) return { ok: false, message: `Missing config file: ${runtime.configPath}` };
  try {
    const config = JSON.parse(raw) as {
      engine?: unknown;
      embedding_model?: unknown;
      embedding_dimensions?: unknown;
    };
    const ok =
      config.engine === "postgres" &&
      config.embedding_model === `litellm:${runtime.embedding.model}` &&
      Number(config.embedding_dimensions) === runtime.embedding.dimensions;
    return {
      ok,
      message: ok
        ? `repo-local config is postgres + ${runtime.embedding.dimensions}d`
        : `config mismatch: ${JSON.stringify({
          engine: config.engine,
          embedding_model: config.embedding_model,
          embedding_dimensions: config.embedding_dimensions,
        })}`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function checkEmbeddingSmoke(runtime: GbrainV5Runtime, fetchImpl: typeof fetch): Promise<{ ok: boolean; message: string }> {
  const response = await fetchImpl(`http://${runtime.embedding.host}:${runtime.embedding.port}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: `litellm:${runtime.embedding.model}`, input: ["DevBrainTeaching v5 smoke"] }),
  });
  if (!response.ok) return { ok: false, message: `HTTP ${response.status}` };
  const body = await response.json() as { data?: Array<{ embedding?: unknown[] }> };
  const length = body.data?.[0]?.embedding?.length ?? 0;
  return {
    ok: length === runtime.embedding.dimensions,
    message: `embedding dimensions ${length}`,
  };
}

async function runSharedChecks(options: {
  runtime: GbrainV5Runtime;
  runner: RuntimeRunner;
  fetchImpl: typeof fetch;
  includePasswordCheck: boolean;
  postgresPassword?: string;
  includeConfigFileCheck: boolean;
  readConfigFile?: ConfigFileReader;
}): Promise<GbrainV5ReadinessReport> {
  const { runtime, runner, fetchImpl } = options;
  const checks: GbrainV5ReadinessReport["checks"] = [];
  const baseEnv = buildGbrainV5BaseEnv(runtime);

  try {
    assertRepoLocalRuntime(runtime);
    checks.push({ name: "repo-local-runtime", ok: true, message: runtime.gbrainHome });
  } catch (error) {
    checks.push({ name: "repo-local-runtime", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  if (options.includePasswordCheck) {
    checks.push({
      name: "postgres-password",
      ok: Boolean(options.postgresPassword ?? process.env.GBRAIN_V5_POSTGRES_PASSWORD),
      message: "GBRAIN_V5_POSTGRES_PASSWORD must be set for init.",
    });
  }

  const dockerVersion = runner("docker", ["--version"], process.env);
  checks.push({
    name: "docker-callable",
    ok: dockerVersion.exitCode === 0,
    message: dockerVersion.stdout.trim() || dockerVersion.stderr.trim(),
  });

  const dockerPs = runner("docker", ["ps", "--format", "{{.Names}} {{.Ports}}"], process.env);
  const expectedContainerOwnsPort = dockerPs.exitCode === 0 && dockerPortOwnedByExpectedContainer(dockerPs.stdout, runtime);
  checks.push({
    name: "postgres-container-port",
    ok: expectedContainerOwnsPort,
    message: expectedContainerOwnsPort ? `${runtime.postgres.containerName} owns ${runtime.postgres.port}` : dockerPs.stdout.trim() || dockerPs.stderr.trim(),
  });

  const health = dockerContainerHealthy(runner, runtime);
  checks.push({
    name: "postgres-container-health",
    ok: health.ok,
    message: health.message,
  });

  try {
    const response = await fetchImpl(`http://${runtime.embedding.host}:${runtime.embedding.port}/health`);
    checks.push({ name: "embedding-health", ok: response.ok, message: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name: "embedding-health", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  try {
    const smoke = await checkEmbeddingSmoke(runtime, fetchImpl);
    checks.push({ name: "embedding-smoke", ok: smoke.ok, message: smoke.message });
  } catch (error) {
    checks.push({ name: "embedding-smoke", ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  const version = runner(process.env.GBRAIN_BIN ?? "gbrain", ["--version"], baseEnv);
  checks.push({ name: "gbrain-version", ok: version.exitCode === 0, message: version.stdout.trim() || version.stderr.trim() });

  checks.push({
    name: "global-gbrain-avoided",
    ok: baseEnv.GBRAIN_HOME === runtime.gbrainHome && !runtime.gbrainHome.includes(`${sep}.gbrain`),
    message: `GBRAIN_HOME=${baseEnv.GBRAIN_HOME}`,
  });

  if (options.includeConfigFileCheck) {
    const config = checkRepoLocalConfigFile(runtime, options.readConfigFile ?? defaultReadConfigFile);
    checks.push({ name: "repo-local-config-file", ok: config.ok, message: config.message });
  }

  return { ready: checks.every((check) => check.ok), runtime, checks };
}

export async function checkGbrainV5Readiness(options: {
  runtime?: GbrainV5Runtime;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
  readConfigFile?: ConfigFileReader;
} = {}): Promise<GbrainV5ReadinessReport> {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  return runSharedChecks({
    runtime,
    runner: options.runner ?? spawnRuntimeCommand,
    fetchImpl: options.fetchImpl ?? fetch,
    includePasswordCheck: false,
    includeConfigFileCheck: true,
    readConfigFile: options.readConfigFile,
  });
}

export async function preflightGbrainV5Init(options: {
  runtime?: GbrainV5Runtime;
  postgresPassword?: string;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
} = {}): Promise<GbrainV5ReadinessReport> {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  return runSharedChecks({
    runtime,
    runner: options.runner ?? spawnRuntimeCommand,
    fetchImpl: options.fetchImpl ?? fetch,
    includePasswordCheck: true,
    postgresPassword: options.postgresPassword,
    includeConfigFileCheck: false,
  });
}

export async function runGbrainV5Init(options: {
  dryRun?: boolean;
  postgresPassword?: string;
  runtime?: GbrainV5Runtime;
  runner?: RuntimeRunner;
  fetchImpl?: typeof fetch;
} = {}): Promise<CommandResult | GbrainV5Command> {
  const runtime = options.runtime ?? defaultGbrainV5Runtime();
  assertRepoLocalRuntime(runtime);
  const password = options.postgresPassword ?? process.env.GBRAIN_V5_POSTGRES_PASSWORD;
  if (!password) throw new Error("Missing GBRAIN_V5_POSTGRES_PASSWORD.");
  const command = buildGbrainV5InitCommand(runtime, password);
  if (options.dryRun) return command;

  const preflight = await preflightGbrainV5Init({
    runtime,
    postgresPassword: password,
    runner: options.runner,
    fetchImpl: options.fetchImpl,
  });
  if (!preflight.ready) {
    throw new Error(`gbrain v5 init preflight failed: ${JSON.stringify(preflight.checks, null, 2)}`);
  }
  return (options.runner ?? spawnRuntimeCommand)(command.command, command.args, command.env);
}
