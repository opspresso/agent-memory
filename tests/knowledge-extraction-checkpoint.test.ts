import { describe, expect, it, vi } from "vitest";
import { createEntityFirstKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-entity-first-extraction-service";
import { createAiRequestLimiter } from "@/infrastructure/ai/request-limiter";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";
import type { KnowledgeExtractionCheckpoint, KnowledgeExtractionCheckpointRepository } from "@/domain/knowledge/knowledge-extraction-checkpoint";

const input = { content: "Atlas 서비스는 Orion 서비스를 사용한다.", documentTitle: "Source", mimeType: "text/plain",
  quotaKey: { organizationId: "org", userId: "owner" }, source: { organizationId: "org", chunkId: "chunk" } };

function fixture() {
  let now = 0;
  const saved = new Map<string, KnowledgeExtractionCheckpoint>();
  const key = (value: { organizationId: string; chunkId: string; fingerprint: string }) => JSON.stringify([value.organizationId, value.chunkId, value.fingerprint]);
  const checkpoints: KnowledgeExtractionCheckpointRepository = {
    find: vi.fn(async (value) => saved.get(key(value)) ?? null),
    save: vi.fn(async (value) => { if (!saved.has(key(value))) saved.set(key(value), value); return saved.get(key(value))!; })
  };
  const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const name = JSON.parse(options!.body as string).response_format.json_schema.name;
    const result = name === "knowledge_entities" ? { entities: ["Atlas", "Orion"].map((canonicalName) => ({
      canonicalName, kind: "service", aliases: [], summary: null, evidenceIds: ["s0"]
    })) } : { relationships: [{ sourceKey: "e0", targetKey: "e1", predicate: "uses", evidenceIds: ["s0"] }] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  });
  const limiter = createAiRequestLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 1, clock: () => now });
  const configuration = { baseUrl: "http://model.test/v1", model: "test", request, requestLimiter: limiter, checkpoints };
  return { configuration, request, checkpoints, nextWindow: () => { now += 60_000; } };
}

describe("durable entity extraction checkpoints", () => {
  it("resumes the relationship pass under a one-request-per-minute quota, including after service restart", async () => {
    const test = fixture();
    await expect(createEntityFirstKnowledgeExtractionService(test.configuration).extract(input)).rejects.toBeInstanceOf(AiRequestLimitExceededError);
    test.nextWindow();
    const result = await createEntityFirstKnowledgeExtractionService(test.configuration).extract(input);
    expect(result.graph.relationships).toEqual([expect.objectContaining({ sourceKey: "e0", targetKey: "e1", predicate: "uses" })]);
    expect(test.request).toHaveBeenCalledTimes(2);
    expect(test.checkpoints.save).toHaveBeenCalledOnce();
  });

  it.each(["content", "model", "language", "ontology"])("does not reuse an entity pass after %s changes", async (change) => {
    const test = fixture();
    await expect(createEntityFirstKnowledgeExtractionService(test.configuration).extract(input)).rejects.toBeInstanceOf(AiRequestLimitExceededError);
    test.nextWindow();
    const configuration = { ...test.configuration, ...(change === "model" ? { model: "other-model" } : {}), ...(change === "language" ? { language: "ko" as const } : {}) };
    const next = { ...input, ...(change === "content" ? { content: input.content + " Orion 서비스는 기록을 저장한다." } : {}),
      ...(change === "ontology" ? { ontology: { mode: "strict" as const, nodeKinds: ["service"], edgePredicates: ["uses"] } } : {}) };
    await expect(createEntityFirstKnowledgeExtractionService(configuration).extract(next)).rejects.toBeInstanceOf(AiRequestLimitExceededError);
    expect(test.checkpoints.save).toHaveBeenCalledTimes(2);
  });

  it("does not persist malformed model output as a reusable checkpoint", async () => {
    const test = fixture();
    test.request.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({ entities: [
      { canonicalName: "Atlas", kind: "service", aliases: [], summary: null, evidenceIds: ["invented"] }
    ] }) } }] }));
    await expect(createEntityFirstKnowledgeExtractionService(test.configuration).extract(input)).rejects.toThrow("unknown source evidence ID");
    expect(test.checkpoints.save).not.toHaveBeenCalled();
  });

  it("does not cross organization boundaries when binding a checkpoint source", async () => {
    const test = fixture();
    await expect(createEntityFirstKnowledgeExtractionService(test.configuration).extract({ ...input,
      source: { ...input.source, organizationId: "other-org" } })).rejects.toThrow("matching source and quota identities");
    expect(test.request).not.toHaveBeenCalled();
    expect(test.checkpoints.find).not.toHaveBeenCalled();
  });
});
