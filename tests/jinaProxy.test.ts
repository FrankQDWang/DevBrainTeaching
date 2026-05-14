import { describe, expect, it } from "bun:test";

import {
  buildJinaEmbeddingPayload,
  createJinaProxyConfig,
  handleJinaProxyRequest,
  normalizeJinaEmbeddingResponse,
} from "../src/jinaProxy.js";

describe("jina proxy", () => {
  it("uses a non-invasive OpenAI-compatible default for Jina v4", () => {
    const config = createJinaProxyConfig({
      JINA_API_KEY: "test-key",
      GBRAIN_EMBEDDING_DIMENSIONS: "1536",
    });

    expect(config.embeddingsUrl).toBe("https://api.jina.ai/v1/embeddings");
    expect(config.model).toBe("jina-embeddings-v4");
    expect(config.dimensions).toBe(1536);
  });

  it("builds an embedding payload with configured dimensions", () => {
    const config = createJinaProxyConfig({
      JINA_API_KEY: "test-key",
      JINA_EMBEDDING_DIMENSIONS: "1024",
    });

    expect(buildJinaEmbeddingPayload({ input: ["hello"] }, config)).toEqual({
      input: ["hello"],
      model: "jina-embeddings-v4",
      dimensions: 1024,
    });
  });

  it("does not override request dimensions when gbrain sends one", () => {
    const config = createJinaProxyConfig({
      JINA_API_KEY: "test-key",
      JINA_EMBEDDING_DIMENSIONS: "1024",
    });

    expect(buildJinaEmbeddingPayload({ input: ["hello"], dimensions: 512 }, config)).toMatchObject({
      dimensions: 512,
    });
  });

  it("strips provider prefixes before forwarding model names to Jina", () => {
    const config = createJinaProxyConfig({ JINA_API_KEY: "test-key" });

    expect(config.dimensions).toBe(1536);
    expect(buildJinaEmbeddingPayload({
      input: ["hello"],
      model: "litellm:jina-embeddings-v4",
    }, config)).toMatchObject({
      model: "jina-embeddings-v4",
    });
  });

  it("normalizes Jina usage for OpenAI-compatible clients", () => {
    expect(normalizeJinaEmbeddingResponse({
      object: "list",
      data: [],
      usage: { total_tokens: 7 },
    })).toEqual({
      object: "list",
      data: [],
      usage: {
        total_tokens: 7,
        prompt_tokens: 7,
      },
    });
  });

  it("forwards embedding requests to Jina and normalizes the response", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const fetchStub: typeof fetch = async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
        usage: { total_tokens: 3 },
      });
    };

    const response = await handleJinaProxyRequest(new Request("http://127.0.0.1:8787/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: ["hello"] }),
    }), {
      env: { JINA_API_KEY: "test-key", JINA_EMBEDDING_DIMENSIONS: "2" },
      fetch: fetchStub,
    });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.jina.ai/v1/embeddings");
    expect(calls[0]?.auth).toBe("Bearer test-key");
    expect(calls[0]?.body).toMatchObject({
      input: ["hello"],
      model: "jina-embeddings-v4",
      dimensions: 2,
    });
    await expect(response.json()).resolves.toMatchObject({
      usage: { total_tokens: 3, prompt_tokens: 3 },
    });
  });

  it("can use the incoming Authorization header instead of JINA_API_KEY", async () => {
    let seenAuth: string | null = null;
    const fetchStub: typeof fetch = async (_url, init) => {
      seenAuth = new Headers(init?.headers).get("authorization");
      return Response.json({ data: [], usage: { total_tokens: 1 } });
    };

    const response = await handleJinaProxyRequest(new Request("http://127.0.0.1:8787/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: "Bearer incoming-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: ["hello"] }),
    }), {
      env: {},
      fetch: fetchStub,
    });

    expect(response.status).toBe(200);
    expect(seenAuth).toBe("Bearer incoming-key");
  });
});
