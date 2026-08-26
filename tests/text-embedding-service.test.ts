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
          model: "openai/text-embedding-3-small"
        }),
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json"
        },
        method: "POST"
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
