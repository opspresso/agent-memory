import { describe, expect, it } from "vitest";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { groupKnowledgeReviewSources, type KnowledgeReviewSource } from "@/domain/knowledge/knowledge-review-group";

function source(id: string): KnowledgeReviewSource {
  return { documentTitle: "삼국지", ordinal: 0, candidate: createKnowledgeCandidate({
    id, scope: { kind: "organization", organizationId: "org" }, documentId: id, chunkId: id, model: "model", now: new Date(),
    graph: {
      entities: [{ key: "liu", kind: "person", canonicalName: "유비" }, { key: "lu", kind: "person", canonicalName: "노식" }],
      relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "student_of", evidence: ["유비는 노식의 제자다."] }]
    }
  }) };
}
describe("consolidated review groups", () => {
  it("groups repeated facts across sources without dropping provenance or distinct relationships", () => {
    const first = source("one");
    const second = source("two");
    const groups = groupKnowledgeReviewSources([first, second]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "relationship", evidenceCount: 1, documentCount: 2 });
    expect(groups[0]?.occurrences.map((occurrence) => occurrence.candidateId)).toEqual(["one", "two"]);
    expect(groups[0]?.occurrences[0]?.selection).toEqual({ entityKeys: [], relationshipIndexes: [0] });
  });
  it("keeps different scopes separate and omits reviewed facts", () => {
    const first = source("one");
    const second = source("two");
    const scoped = { ...second, candidate: { ...second.candidate, scope: { kind: "user" as const, organizationId: "org", userId: "user" } } };
    expect(groupKnowledgeReviewSources([first, scoped])).toHaveLength(6);
    const reviewed = { ...first, candidate: { ...first.candidate, itemReviews: [ { item: "relationship:0", decision: "accepted" as const, reviewedBy: "user", reviewedAt: new Date().toISOString() } ] } };
    expect(groupKnowledgeReviewSources([reviewed])).toHaveLength(2);
  });
  it("puts vague legacy relations after specific evidence-backed facts", () => {
    const first = source("one");
    const vague = { ...first, candidate: { ...first.candidate, graph: { ...first.candidate.graph,
      relationships: [...first.candidate.graph.relationships, { sourceKey: "liu", targetKey: "lu", predicate: "associated_with" }] } } };
    const groups = groupKnowledgeReviewSources([vague]);
    expect(groups[0]?.predicate).toBe("student_of");
    expect(groups.at(-1)).toMatchObject({ predicate: "associated_with", weak: true });
  });
});
