import { buildListKnowledgeReviewGroups } from "@/application/knowledge/list-knowledge-review-groups";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import { describe, expect, it, vi } from "vitest";
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


describe("review queue after an ontology change", () => {
  it("surfaces the blocked automatic batch while retaining the verifier assessment", async () => {
    const original = source("one");
    const candidate = { ...original.candidate, assessment: {
      model: "verifier", policyVersion: "evidence-v1" as const, assessedAt: new Date().toISOString(),
      items: ["entity:liu", "entity:lu", "relationship:0"].map((item) => ({
        item, verdict: "accept" as const, evidence: "유비는 노식의 제자다.", reason: "Explicit"
      }))
    } };
    const repository = {
      listReviewSources: vi.fn().mockResolvedValue([{ ...original, candidate }]),
      reviewSummary: vi.fn().mockResolvedValue({ automaticAccepted: 0, automaticIgnored: 0 })
    } as unknown as KnowledgeCandidateRepository;
    const findByOrganization = vi.fn().mockResolvedValue({ mode: "strict", ontology: { nodeKinds: ["person"], edgePredicates: ["works_for"] } });
    const list = buildListKnowledgeReviewGroups(repository, { findByOrganization });
    const access = { organizationId: "org", userId: "owner", role: "owner" as const, teams: [] };
    const result = await list(access, { offset: 0, limit: 25 });
    expect(result.total).toBe(3);
    expect(result.groups.find((group) => group.kind === "relationship")?.ontology.violations).toEqual([{ type: "unknown_predicate", term: "student_of" }]);
    expect(result.groups[0]?.occurrences[0]?.assessmentReason).toContain("blocked");
    expect(candidate.assessment.items.every((item) => item.verdict === "accept")).toBe(true);
    findByOrganization.mockResolvedValue({ mode: "warn", ontology: { nodeKinds: ["person"], edgePredicates: ["works_for"] } });
    expect((await list(access, { offset: 0, limit: 25 })).total).toBe(0);
  });
});
