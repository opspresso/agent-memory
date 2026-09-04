import { describe, expect, it, vi } from "vitest";

import { TextRerankerUnavailableError } from "@/domain/shared/text-reranker-service";
import { createTextRerankerService } from "@/infrastructure/ai/text-reranker-service";

describe("text reranker service", () => {
  it("returns relevance scores in document order", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.2 }
        ]
      })
    );
    const reranker = createTextRerankerService({
      apiKey: "reranker-key",
      baseUrl: "http://reranker.test/v1/",
      model: "reranker-model",
      request
    });

    await expect(
      reranker.rerank({ query: "query", documents: ["first", "second"] })
    ).resolves.toEqual([0.2, 0.9]);
    expect(request).toHaveBeenCalledWith(
      "http://reranker.test/v1/rerank",
      expect.objectContaining({
        body: JSON.stringify({
          documents: ["first", "second"],
          model: "reranker-model",
          query: "query",
          top_n: 2
        }),
        headers: {
          Authorization: "Bearer reranker-key",
          "Content-Type": "application/json"
        },
        method: "POST"
      })
    );
  });

  it("does not call the provider for an empty document list", async () => {
    const request = vi.fn();
    const reranker = createTextRerankerService({
      baseUrl: "http://reranker.test/v1",
      model: "reranker-model",
      request
    });

    await expect(
      reranker.rerank({ query: "query", documents: [] })
    ).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a missing result",
      body: { results: [{ index: 0, relevance_score: 0.2 }] }
    },
    {
      name: "a duplicate index",
      body: {
        results: [
          { index: 0, relevance_score: 0.2 },
          { index: 0, relevance_score: 0.9 }
        ]
      }
    },
    {
      name: "a non-finite score",
      body: {
        results: [
          { index: 0, relevance_score: "invalid" },
          { index: 1, relevance_score: 0.9 }
        ]
      }
    }
  ])("rejects $name", async ({ body }) => {
    const reranker = createTextRerankerService({
      baseUrl: "http://reranker.test/v1",
      model: "reranker-model",
      request: vi.fn().mockResolvedValue(Response.json(body))
    });

    await expect(
      reranker.rerank({ query: "query", documents: ["first", "second"] })
    ).rejects.toBeInstanceOf(TextRerankerUnavailableError);
  });

  it("normalizes provider failures", async () => {
    const reranker = createTextRerankerService({
      baseUrl: "http://reranker.test/v1",
      model: "reranker-model",
      request: vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    });

    await expect(
      reranker.rerank({ query: "query", documents: ["first"] })
    ).rejects.toBeInstanceOf(TextRerankerUnavailableError);
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const reranker = createTextRerankerService({
      baseUrl: "http://reranker.test/v1",
      model: "reranker-model",
      request: vi.fn().mockRejectedValue(new Error("request aborted"))
    });

    await expect(
      reranker.rerank({
        query: "query",
        documents: ["first"],
        signal: controller.signal
      })
    ).rejects.toThrow("cancelled");
  });
});
