import { describe, expect, it, vi } from "vitest";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";

const now = new Date("2026-09-09T00:00:00Z");
const candidate = createKnowledgeCandidate({ id: "c", documentId: "d", chunkId: "ch", model: "extractor", now,
  scope: { organizationId: "org", kind: "organization" },
  graph: { entities: [{ key: "a", kind: "person", canonicalName: "A" }], relationships: [] } });
function setup() {
  const findByUser = vi.fn().mockResolvedValue({ organizationId: "org", userId: "owner", role: "owner", teams: [] });
  const verify = vi.fn().mockResolvedValue({ model: "verifier", items: [{ item: "entity:a", support: "explicit", usefulness: "useful", conflict: false, evidence: "A leads the team.", reason: "Explicit role" }] });
  const accept = vi.fn();
  const reject = vi.fn();
  const saveAssessment = vi.fn().mockImplementation(async (_org, _id, assessment) => ({ ...candidate, assessment }));
  const findByChunkId = vi.fn().mockResolvedValue(candidate);
  const existingKnowledge = vi.fn().mockResolvedValue([]);
  const run = buildCurateKnowledgeCandidate({
    candidates: { findByChunkId, saveAssessment },
    documents: { findChunkById: vi.fn().mockResolvedValue({ document: { status: "ready", createdBy: "owner", title: "People" }, chunk: { content: "A leads the team." } }) },
    access: { findByUser }, graph: { findNodesByCanonicalNames: existingKnowledge },
    ontology: { findByOrganization: vi.fn().mockResolvedValue(null) }, verification: { verify }, accept, reject, clock: () => now
  });
  return { run, findByUser, verify, accept, reject, saveAssessment, findByChunkId, existingKnowledge };
}
describe("automatic curation orchestration", () => {
  it("bounds accumulated context without truncating the source under verification", async () => {
    const test = setup();
    test.existingKnowledge.mockResolvedValue([{ canonicalName: "A", kind: "person", summary: "x".repeat(10_000) }]);
    await test.run("org", "ch");
    expect(test.verify.mock.calls[0]?.[0]).toMatchObject({
      content: "A leads the team.",
      existingKnowledge: [{ name: "A", summary: "x".repeat(2_000) }]
    });
  });
  it("verifies then persists its assessment before automatically accepting qualified facts", async () => {
    const test = setup();
    await test.run("org", "ch");
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.saveAssessment).toHaveBeenCalledOnce();
    expect(test.accept).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner" }), "c", expect.stringContaining("Automatic"), { entityKeys: ["a"], relationshipIndexes: [] });
    expect(test.reject).not.toHaveBeenCalled();
  });
  it("does not verify or mutate without a current principal allowed to manage the source", async () => {
    const test = setup();
    test.findByUser.mockResolvedValue(null);
    await test.run("org", "ch");
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
  });
  it("rechecks membership after AI verification", async () => {
    const test = setup();
    test.findByUser.mockResolvedValueOnce({ organizationId: "org", userId: "owner", role: "owner", teams: [] }).mockResolvedValueOnce(null);
    await test.run("org", "ch");
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.accept).not.toHaveBeenCalled();
    expect(test.reject).not.toHaveBeenCalled();
  });
  it("fails closed when verification fails", async () => {
    const test = setup();
    test.verify.mockRejectedValue(new Error("provider unavailable"));
    await expect(test.run("org", "ch")).rejects.toThrow("provider unavailable");
    expect(test.saveAssessment).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
    expect(test.reject).not.toHaveBeenCalled();
  });
  it("uses the authenticated queue initiator and skips already completed candidates", async () => {
    const test = setup();
    await test.run("org", "ch", "administrator");
    expect(test.findByUser).toHaveBeenCalledWith("org", "administrator");
    test.verify.mockClear();
    test.findByChunkId.mockResolvedValue({ ...candidate, status: "accepted" });
    await test.run("org", "ch");
    expect(test.verify).not.toHaveBeenCalled();
  });
});
