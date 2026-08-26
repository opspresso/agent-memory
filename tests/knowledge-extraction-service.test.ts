import { describe, expect, it, vi } from "vitest";

import { createKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-extraction-service";

describe("knowledge extraction service", () => {
  it("requests a bounded structured graph from an OpenAI-compatible endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [
                  { key: "api", kind: "service", canonicalName: "Memory API" },
                  { key: "db", kind: "database", canonicalName: "PostgreSQL" }
                ],
                relationships: [
                  { sourceKey: "api", targetKey: "db", predicate: "stores_in" }
                ]
              })
            }
          }
        ]
      })
    );
    const service = createKnowledgeExtractionService({
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "test/model",
      request
    });

    await expect(
      service.extract({
        documentTitle: "Architecture",
        content: "Memory API stores data in PostgreSQL."
      })
    ).resolves.toMatchObject({
      model: "test/model",
      graph: {
        entities: [{ key: "api" }, { key: "db" }],
        relationships: [{ predicate: "stores_in" }]
      }
    });
    expect(request).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
    const body = JSON.parse(
      vi.mocked(request).mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "test/model",
      response_format: { type: "json_schema" },
      temperature: 0
    });
  });

  it("rejects malformed model output without exposing source content or credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "not-json" } }]
      })
    );
    const service = createKnowledgeExtractionService({
      apiKey: "secret-key",
      baseUrl: "https://example.test/v1",
      model: "test/model",
      request
    });
    const result = service.extract({
      documentTitle: "Private",
      content: "private document content"
    });

    await expect(result).rejects.toThrow(
      "knowledge extraction response content is not JSON"
    );
    await expect(result).rejects.not.toThrow("private document content");
    await expect(result).rejects.not.toThrow("secret-key");
  });

  it("rejects relationships with missing entity endpoints", async () => {
    const service = createKnowledgeExtractionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entities: [],
                  relationships: [
                    { sourceKey: "missing", targetKey: "other", predicate: "calls" }
                  ]
                })
              }
            }
          ]
        })
      )
    });

    await expect(
      service.extract({ documentTitle: "Invalid", content: "content" })
    ).rejects.toThrow("knowledge extraction graph is invalid");
  });
});
