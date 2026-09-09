import { buildQueueKnowledgeCuration } from "@/application/knowledge/queue-knowledge-curation";
import { describe, expect, it, vi } from "vitest";
import { readKnowledgeEnrichmentConcurrency } from "@/lib/document-worker-configuration";
import { mergeKnowledgeDescriptions } from "@/domain/knowledge/knowledge-description";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";

describe("knowledge enrichment quality", () => {
  it("prioritizes a requested entity without requeueing unrelated candidates", async () => {
    const make = (name: string) => ({ candidate: createKnowledgeCandidate({ id: name, documentId: "d", chunkId: name, model: "old",
      scope: { kind: "organization", organizationId: "org" }, graph: { entities: [{ key: "a", kind: "person", canonicalName: name }], relationships: [] }, now: new Date() }), documentTitle: "Novel", ordinal: 0 });
    const enqueueKnowledgeEnrichment = vi.fn().mockResolvedValue("already_queued");
    const queue = buildQueueKnowledgeCuration({ listReviewSources: vi.fn().mockResolvedValue([make("관우"), make("조조")]) }, { enqueueKnowledgeEnrichment });
    expect(await queue({ organizationId: "org", userId: "owner", role: "owner", teams: [] }, "관우")).toEqual({ queued: 1 });
    expect(enqueueKnowledgeEnrichment).toHaveBeenCalledExactlyOnceWith("org", "관우", "owner", 20);
  });
  it("uses bounded concurrency without exceeding the shared AI ceiling", () => {
    expect(readKnowledgeEnrichmentConcurrency({})).toBe(4);
    expect(readKnowledgeEnrichmentConcurrency({ AI_PROVIDER_MAX_CONCURRENCY: "2" })).toBe(2);
    expect(readKnowledgeEnrichmentConcurrency({ KNOWLEDGE_ENRICHMENT_CONCURRENCY: "6" })).toBe(6);
    for (const value of ["0", "17", "1.5", "invalid"]) {
      expect(() => readKnowledgeEnrichmentConcurrency({ KNOWLEDGE_ENRICHMENT_CONCURRENCY: value })).toThrow();
    }
  });
  it("keeps different source descriptions and removes exact repetition deterministically", () => {
    expect(mergeKnowledgeDescriptions(["Leads cavalry.", "Studies strategy.", " Leads  cavalry. "])).toBe("Leads cavalry.\n\nStudies strategy.");
    expect(mergeKnowledgeDescriptions([])).toBeUndefined();
    expect(mergeKnowledgeDescriptions(["a".repeat(6_000), "b".repeat(6_000)])?.length).toBeLessThanOrEqual(10_000);
  });
});
