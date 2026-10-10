import { describe, expect, it, vi } from "vitest";
import { createKnowledgeStructuredClient } from "@/infrastructure/ai/knowledge-structured-client";
import { createKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-extraction-service";
import { createKnowledgeOntologySuggestionService } from "@/infrastructure/ai/knowledge-ontology-suggestion-service";
import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";
import { createTextRerankerService } from "@/infrastructure/ai/text-reranker-service";
import { createKnowledgeVerificationService } from "@/infrastructure/ai/knowledge-verification-service";
import { readAiJsonResponse } from "@/infrastructure/ai/read-ai-response";
import { createAiRequestLimiter } from "@/infrastructure/ai/request-limiter";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";

const configuration = { baseUrl: "http://provider.test/v1", model: "fixture" };
const kinds = ["structured", "single-pass", "verification", "ontology", "embedding", "reranker"] as const;
function operation(kind: typeof kinds[number], response: Response) {
  const config = { ...configuration, request: vi.fn<typeof fetch>().mockResolvedValue(response) };
  return kind === "structured" ? createKnowledgeStructuredClient(config).generate("system", {}, {})
    : kind === "single-pass" ? createKnowledgeExtractionService(config).extract({ content: "Atlas", documentTitle: "Source", mimeType: "text/plain" })
    : kind === "verification" ? createKnowledgeVerificationService(config).verify({ quotaKey: { organizationId: "org", userId: "user" }, content: "Atlas", documentTitle: "Source", existingKnowledge: [], graph: { entities: [{ key: "atlas", kind: "service", canonicalName: "Atlas" }], relationships: [] } })
    : kind === "ontology" ? createKnowledgeOntologySuggestionService(config).suggest({ ontology: { nodeKinds: [], edgePredicates: [] }, usage: { nodeKinds: [], edgePredicates: [] } })
    : kind === "embedding" ? createTextEmbeddingService(config).embed("Source")
    : createTextRerankerService(config).rerank({ query: "q", documents: ["Source"] });
}

describe("AI response boundary", () => {
  it.each(["single-pass", "verification", "ontology"])("charges exactly one quota permit for a %s request", async (kind) => {
    const requestLimiter = createAiRequestLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 1 });
    const run = vi.spyOn(requestLimiter, "run");
    const result = kind === "single-pass" ? { entities: [], relationships: [] } : kind === "ontology" ? { nodeKinds: [], edgePredicates: [] }
      : { items: { "entity:e0": { entityKind: "service", representation: "entity", support: "explicit", usefulness: "useful",
        conflict: false, evidenceId: "s0", reason: "Named service." } } };
    const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    const config = { ...configuration, model: " fixture ", requestLimiter, request }, quotaKey = { organizationId: "org", userId: "user" };
    const invoke = kind === "single-pass" ? () => createKnowledgeExtractionService(config).extract({ quotaKey, content: "Atlas", documentTitle: "Source", mimeType: "text/plain" })
      : kind === "ontology" ? () => createKnowledgeOntologySuggestionService(config).suggest({ quotaKey, ontology: { nodeKinds: [], edgePredicates: [] }, usage: { nodeKinds: [], edgePredicates: [] } })
      : () => createKnowledgeVerificationService(config).verify({ quotaKey, content: "Atlas", documentTitle: "Source", existingKnowledge: [], graph: { entities: [{ key: "atlas", kind: "service", canonicalName: "Atlas" }], relationships: [] } });
    const resolved = await invoke();
    if (kind !== "ontology") expect(resolved).toMatchObject({ model: "fixture" });
    expect(run).toHaveBeenCalledExactlyOnceWith(expect.any(Function), quotaKey);
    await expect(invoke()).rejects.toBeInstanceOf(AiRequestLimitExceededError);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(kinds)("does not retain provider source text in %s JSON errors", async (kind) => {
    const error = await operation(kind, new Response('SECRET99')).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("expected provider rejection");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("SECRET99");
    if (error instanceof Error && error.cause) expect(String(error.cause)).not.toContain("SECRET99");
  });

  it.each(kinds)("cancels unused %s HTTP error bodies", async (kind) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 503 });
    await expect(operation(kind, response)).rejects.toBeInstanceOf(Error);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("decodes split UTF-8 at the exact byte limit", async () => {
    const value = { text: "한글 😀" }, bytes = new TextEncoder().encode(JSON.stringify(value));
    let offset = 0;
    const response = new Response(new ReadableStream({ pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
      else controller.close();
    } }));
    await expect(readAiJsonResponse(response, bytes.length)).resolves.toEqual(value);
  });

  it.each([undefined, "1", "10000"])("bounds actual bytes and cancels responses with declared length %s", async (length) => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel }),
      { headers: length ? { "Content-Length": length } : undefined });
    await expect(readAiJsonResponse(response, 50)).rejects.toMatchObject({ code: "AI_RESPONSE_TOO_LARGE" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("discards stream errors and invalid UTF-8 without preserving provider details", async () => {
    for (const response of [new Response(new Uint8Array([0xff])), new Response(new ReadableStream({
      start(controller) { controller.error(new Error("SECRET99")); }
    }))]) {
      const error = await readAiJsonResponse(response).catch((error: unknown) => error);
      expect(error).toMatchObject({ code: "AI_RESPONSE_INVALID" });
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("SECRET99");
    }
  });

  it("sizes embedding response budgets for the requested vectors", async () => {
    const response = new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }],
      unexpected: "x".repeat(128 * 1_024) }));
    await expect(createTextEmbeddingService({ ...configuration, dimensions: 2,
      request: vi.fn<typeof fetch>().mockResolvedValue(response) }).embed("source"))
      .rejects.toMatchObject({ code: "AI_RESPONSE_TOO_LARGE" });
  });

  it("bounds reranker envelopes by the requested score count", async () => {
    const response = new Response(JSON.stringify({ results: [{ index: 0, relevance_score: 0.8 }],
      unexpected: "x".repeat(128 * 1_024) }));
    await expect(operation("reranker", response)).rejects.toMatchObject({ cause: { code: "AI_RESPONSE_TOO_LARGE" } });
  });

  it("cancels an oversized streamed completion before consuming the remainder", async () => {
    const block = new Uint8Array(1_048_576).fill(32);
    let blocks = 0;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      pull(controller) {
        if (blocks++ < 40) controller.enqueue(block);
        else { controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"{}"}}]}')); controller.close(); }
      }, cancel
    }));
    const client = createKnowledgeStructuredClient({ ...configuration, request: vi.fn<typeof fetch>().mockResolvedValue(response) });
    await expect(client.generate("system", {}, {})).rejects.toThrow("byte limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(blocks).toBeLessThan(40);
  });
});
