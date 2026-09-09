import { describe, expect, it } from "vitest";
import { createKnowledgeCandidate, type KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { reviewedCandidateState, selectKnowledgeCandidateItems } from "@/domain/knowledge/knowledge-candidate-selection";

function candidate(): KnowledgeCandidate {
  return createKnowledgeCandidate({ id: "c", documentId: "d", chunkId: "ch", model: "model", now: new Date(),
    scope: { organizationId: "org", kind: "organization" }, graph: {
      entities: ["a", "b", "c"].map((key) => ({ key, kind: "person", canonicalName: key })),
      relationships: [ { sourceKey: "a", targetKey: "b", predicate: "student_of" }, { sourceKey: "b", targetKey: "c", predicate: "parent_of" } ]
    } });
}
const review = (item: string, decision: "accepted" | "rejected" = "accepted") => ({ item, decision, reviewedBy: "user", reviewedAt: new Date().toISOString() });

describe("incremental knowledge review", () => {
  it("accepts only a selected relationship and its endpoints, leaving other facts pending", () => {
    const source = candidate();
    const selected = selectKnowledgeCandidateItems(source, { entityKeys: [], relationshipIndexes: [0] });
    expect(selected.graph.entities.map((entity) => entity.key)).toEqual(["a", "b"]);
    expect(selected.relationshipIndexes).toEqual([0]);
    const state = reviewedCandidateState(source, selected.items.map((item) => review(item)));
    expect(state.status).toBe("pending");
    const next = selectKnowledgeCandidateItems({ ...source, ...state }, { entityKeys: [], relationshipIndexes: [1] });
    expect(next.items).toEqual(["entity:c", "relationship:1"]);
    expect(next.graph.entities.map((entity) => entity.key)).toEqual(["b", "c"]);
    expect(reviewedCandidateState({ ...source, ...state }, next.items.map((item) => review(item))).status).toBe("accepted");
  });
  it("makes replay idempotent and rejects opposite decisions", () => {
    const source = { ...candidate(), itemReviews: [review("entity:a")] };
    expect(selectKnowledgeCandidateItems(source, { entityKeys: ["a"], relationshipIndexes: [] }).items).toEqual([]);
    expect(() => selectKnowledgeCandidateItems(source, { entityKeys: ["a"], relationshipIndexes: [] }, "rejected")).toThrow("opposite");
  });
  it("rejecting an entity also rejects its unreviewed incident relationships", () => {
    const selected = selectKnowledgeCandidateItems(candidate(), { entityKeys: ["b"], relationshipIndexes: [] }, "rejected");
    expect(selected.items).toEqual(["entity:b", "relationship:0", "relationship:1"]);
    expect(selected.graph.entities.map((entity) => entity.key)).toEqual(["b"]);
  });
  it("rejecting a relation does not reject its entities", () => {
    expect(selectKnowledgeCandidateItems(candidate(), { entityKeys: [], relationshipIndexes: [0] }, "rejected").items).toEqual(["relationship:0"]);
  });
  it("validates unknown, empty and out-of-range selections", () => {
    for (const selection of [ { entityKeys: [], relationshipIndexes: [] }, { entityKeys: ["missing"], relationshipIndexes: [] }, { entityKeys: [], relationshipIndexes: [-1] } ]) {
      expect(() => selectKnowledgeCandidateItems(candidate(), selection)).toThrow();
    }
  });
});
