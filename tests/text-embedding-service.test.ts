import { describe, expect, it, vi } from "vitest";

import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";

describe("text embedding service", () => {
  it("calls an OpenAI-compatible embeddings endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [
          { embedding: [0.3, 0.4], index: 1 },
          { embedding: [0.1, 0.2], index: 0 }
        ],
        model: "openai/text-embedding-3-small",
        object: "list"
      })
    );
    const service = createTextEmbeddingService({
      apiKey: "test-api-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
      request
    });

    await expect(service.embedMany(["first", "second"])).resolves.toEqual([
      { model: "openai/text-embedding-3-small", values: [0.1, 0.2] },
      { model: "openai/text-embedding-3-small", values: [0.3, 0.4] }
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        body: JSON.stringify({
          input: ["first", "second"],
          model: "openai/text-embedding-3-small",
          encoding_format: "float"
        }),
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("supports an unauthenticated local endpoint", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [{ embedding: [0.1], index: 0 }] })
      );
    const service = createTextEmbeddingService({
      baseUrl: "http://localhost:11434/v1/",
      model: "nomic-embed-text",
      request
    });

    await service.embed("local input");

    expect(request).toHaveBeenCalledWith(
      "http://localhost:11434/v1/embeddings",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("requests explicit dimensions and verifies the returned width", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ embedding: [0.1, 0.2], index: 0 }] })
    );
    const service = createTextEmbeddingService({ baseUrl: "http://embedding.test/v1", model: "model", dimensions: 2, request });
    await expect(service.embed("input")).resolves.toMatchObject({ values: [0.1, 0.2] });
    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({ input: ["input"], model: "model", encoding_format: "float", dimensions: 2 });
  });

  it("rejects a provider that ignores the requested dimensions", async () => {
    const service = createTextEmbeddingService({
      baseUrl: "http://embedding.test/v1", model: "model", dimensions: 3,
      request: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ embedding: [0.1, 0.2], index: 0 }] }))
    });
    await expect(service.embed("private input")).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_DIMENSION_MISMATCH" });
  });

  it("rejects inconsistent native dimensions within a batch", async () => {
    const service = createTextEmbeddingService({
      baseUrl: "http://embedding.test/v1", model: "model",
      request: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ embedding: [0.1], index: 0 }, { embedding: [0.1, 0.2], index: 1 }] }))
    });
    await expect(service.embedMany(["first", "second"])).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_DIMENSION_MISMATCH" });
  });

  it.each([[0, 0], [1e-100, 0], [1e100, 0]])("rejects a vector that is invalid in float32 storage: %j", async (...values) => {
    const service = createTextEmbeddingService({ baseUrl: "http://embedding.test/v1", model: "model",
      request: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ embedding: values, index: 0 }] })) });
    await expect(service.embed("input")).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_INVALID" });
  });

  it("rejects dimensions and native responses that exceed storage capacity", async () => {
    expect(() => createTextEmbeddingService({ baseUrl: "http://embedding.test/v1", model: "model", dimensions: 16001 }))
      .toThrow("embedding dimensions must be an integer between 1 and 16000");
    const service = createTextEmbeddingService({ baseUrl: "http://embedding.test/v1", model: "model",
      request: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ embedding: new Array(16001).fill(0.1), index: 0 }] })) });
    await expect(service.embed("input")).rejects.toMatchObject({ code: "EMBEDDING_RESPONSE_INVALID" });
  });

  it("does not expose input or credentials in request errors", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { message: "invalid credentials" } },
        { status: 401 }
      )
    );
    const service = createTextEmbeddingService({
      apiKey: "secret-api-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/text-embedding-3-small",
      request
    });

    const result = service.embed("private document content");

    await expect(result).rejects.toThrow(
      "embedding request failed with status 401"
    );
    await expect(result).rejects.not.toThrow("private document content");
    await expect(result).rejects.not.toThrow("secret-api-key");
  });
});
