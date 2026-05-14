const defaultListenHost = "127.0.0.1";
const defaultListenPort = 8787;
const defaultJinaEmbeddingsUrl = "https://api.jina.ai/v1/embeddings";
const defaultJinaModel = "jina-embeddings-v4";
const defaultJinaDimensions = 1536;

export interface JinaProxyEnv {
  JINA_API_KEY?: string;
  JINA_BASE_URL?: string;
  JINA_EMBEDDING_MODEL?: string;
  JINA_EMBEDDING_DIMENSIONS?: string;
  JINA_EMBEDDING_TASK?: string;
  GBRAIN_EMBEDDING_DIMENSIONS?: string;
  JINA_PROXY_HOST?: string;
  JINA_PROXY_PORT?: string;
  PORT?: string;
}

export interface JinaProxyConfig {
  apiKey?: string;
  embeddingsUrl: string;
  model: string;
  dimensions: number;
  task?: string;
  host: string;
  port: number;
}

export interface JinaProxyOptions {
  env?: JinaProxyEnv;
  fetch?: typeof fetch;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return undefined;
  const token = match[1]?.trim();
  if (!token || token === "unauthenticated") return undefined;
  return token;
}

function normalizeJinaModel(model: unknown, fallback: string): string {
  if (typeof model !== "string" || model.length === 0) return fallback;
  if (model.startsWith("litellm:") || model.startsWith("jina:")) {
    return model.slice(model.indexOf(":") + 1);
  }
  return model;
}

export function createJinaProxyConfig(env: JinaProxyEnv = process.env, incomingAuthorization?: string | null): JinaProxyConfig {
  const baseUrl = cleanBaseUrl(env.JINA_BASE_URL);
  const dimensions = positiveInt(
    env.JINA_EMBEDDING_DIMENSIONS ?? env.GBRAIN_EMBEDDING_DIMENSIONS,
    defaultJinaDimensions,
  );

  return {
    apiKey: env.JINA_API_KEY || bearerToken(incomingAuthorization ?? null),
    embeddingsUrl: baseUrl ? `${baseUrl}/embeddings` : defaultJinaEmbeddingsUrl,
    model: env.JINA_EMBEDDING_MODEL || defaultJinaModel,
    dimensions,
    ...(env.JINA_EMBEDDING_TASK ? { task: env.JINA_EMBEDDING_TASK } : {}),
    host: env.JINA_PROXY_HOST || defaultListenHost,
    port: positiveInt(env.JINA_PROXY_PORT ?? env.PORT, defaultListenPort),
  };
}

export function buildJinaEmbeddingPayload(inputPayload: unknown, config: JinaProxyConfig): Record<string, unknown> {
  if (!inputPayload || typeof inputPayload !== "object") {
    throw new Error("Embedding request body must be a JSON object.");
  }

  const body = inputPayload as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    ...body,
    model: normalizeJinaModel(body.model, config.model),
    dimensions: typeof body.dimensions === "number" && body.dimensions > 0 ? body.dimensions : config.dimensions,
  };

  if (config.task && payload.task === undefined) {
    payload.task = config.task;
  }

  return payload;
}

export function normalizeJinaEmbeddingResponse(inputPayload: unknown): unknown {
  if (!inputPayload || typeof inputPayload !== "object") {
    return inputPayload;
  }

  const body = inputPayload as Record<string, unknown>;
  const usage = body.usage;
  if (!usage || typeof usage !== "object") {
    return {
      ...body,
      usage: {
        prompt_tokens: 0,
        total_tokens: 0,
      },
    };
  }

  const usageRecord = usage as Record<string, unknown>;
  if (typeof usageRecord.prompt_tokens === "number") {
    return body;
  }

  return {
    ...body,
    usage: {
      ...usageRecord,
      prompt_tokens: typeof usageRecord.total_tokens === "number" ? usageRecord.total_tokens : 0,
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

export async function handleJinaProxyRequest(request: Request, options: JinaProxyOptions = {}): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    const config = createJinaProxyConfig(options.env, request.headers.get("authorization"));
    return jsonResponse({
      ok: true,
      provider: "jina",
      model: config.model,
      dimensions: config.dimensions,
      has_api_key: Boolean(config.apiKey),
    });
  }

  if (request.method !== "POST" || url.pathname !== "/v1/embeddings") {
    return jsonResponse({ error: "Not found. Use POST /v1/embeddings." }, 404);
  }

  const config = createJinaProxyConfig(options.env, request.headers.get("authorization"));
  if (!config.apiKey) {
    return jsonResponse({
      error: "Missing Jina API key. Set JINA_API_KEY or send Authorization: Bearer <key>.",
    }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Embedding request body must be valid JSON." }, 400);
  }

  let outboundPayload: Record<string, unknown>;
  try {
    outboundPayload = buildJinaEmbeddingPayload(body, config);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const fetchImpl = options.fetch ?? fetch;
  const upstream = await fetchImpl(config.embeddingsUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(outboundPayload),
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  }

  const upstreamJson = await upstream.json();
  const normalized = upstream.ok ? normalizeJinaEmbeddingResponse(upstreamJson) : upstreamJson;
  return jsonResponse(normalized, upstream.status);
}

export function startJinaProxy(env: JinaProxyEnv = process.env): void {
  const config = createJinaProxyConfig(env);
  Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: (request) => handleJinaProxyRequest(request, { env }),
  });

  console.log(`Jina proxy listening on http://${config.host}:${config.port}/v1`);
  console.log(`Model: ${config.model}, dimensions: ${config.dimensions}`);
  if (!config.apiKey) {
    console.log("JINA_API_KEY is not set; requests must send Authorization: Bearer <Jina key>.");
  }
}

export async function runJinaSmoke(env: JinaProxyEnv = process.env): Promise<void> {
  const config = createJinaProxyConfig(env);
  if (!config.apiKey) {
    throw new Error("Missing JINA_API_KEY for smoke test.");
  }

  const payload = buildJinaEmbeddingPayload({
    input: ["DevBrainTeaching Jina v4 smoke test"],
  }, config);

  const response = await fetch(config.embeddingsUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Jina smoke test failed: HTTP ${response.status} ${await response.text()}`);
  }

  const json = await response.json() as { data?: Array<{ embedding?: unknown[] }> };
  const dims = json.data?.[0]?.embedding?.length;
  if (typeof dims !== "number") {
    throw new Error("Jina smoke test failed: response did not include an embedding vector.");
  }

  console.log(`Jina smoke test OK: ${dims} dims`);
}
