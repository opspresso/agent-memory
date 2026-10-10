import { describe, expect, it } from "vitest";
import { uniqueKnowledgeSources } from "@/domain/knowledge/knowledge-source";
import { assertAutomaticKnowledgeAssessment, currentKnowledgeAssessmentPolicyVersion,
  KnowledgeAssessmentUnavailableError, type KnowledgeCandidateAssessment } from "@/domain/knowledge/knowledge-assessment";

describe("assessment provenance", () => {
  it("retains distinct source types while deduplicating references and discarding unrelated metadata", () => {
    const source = { chunkId: "same-id", description: "not part of a source reference" };
    expect(uniqueKnowledgeSources([source, { chunkId: "same-id" }, { memoryId: "same-id" }]))
      .toEqual([{ chunkId: "same-id" }, { memoryId: "same-id" }]);
  });

  it.each([{}, { chunkId: " " }, { memoryId: "" }, { memoryId: "memory", chunkId: "chunk" }])(
    "rejects missing or ambiguous source references: %j", (source) => {
      expect(() => uniqueKnowledgeSources([source])).toThrow("exactly one non-empty source ID");
    }
  );

  it("requires a current, sourced assessment and a matching verdict for every automatic decision", () => {
    const assessment: KnowledgeCandidateAssessment = { contextNodeIds: [], sources: [{ chunkId: "chunk" }], model: "verifier",
      policyVersion: currentKnowledgeAssessmentPolicyVersion, assessedAt: new Date().toISOString(),
      items: [{ item: "entity:a", verdict: "accept", evidence: "A", reason: "Named entity" }] };
    expect(() => assertAutomaticKnowledgeAssessment(assessment, ["entity:a"], "accept")).not.toThrow();
    for (const value of [undefined, { ...assessment, sources: [] }, { ...assessment, policyVersion: "obsolete" }]) {
      expect(() => assertAutomaticKnowledgeAssessment(value, ["entity:a"], "accept")).toThrow(KnowledgeAssessmentUnavailableError);
    }
    expect(() => assertAutomaticKnowledgeAssessment(assessment, ["entity:missing"], "accept")).toThrow(KnowledgeAssessmentUnavailableError);
    expect(() => assertAutomaticKnowledgeAssessment(assessment, ["entity:a"], "ignore")).toThrow(KnowledgeAssessmentUnavailableError);
  });
});
