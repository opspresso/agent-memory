import { describe, expect, it, vi } from "vitest";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";

const now = new Date("2026-09-09T00:00:00Z");
const candidate = createKnowledgeCandidate({ id: "c", documentId: "d", chunkId: "ch", model: "extractor", now,
  scope: { organizationId: "org", kind: "organization" },
  graph: { entities: [{ key: "a", kind: "person", canonicalName: "A" }], relationships: [] } });
function setup() {
  const findByUser = vi.fn().mockResolvedValue({ organizationId: "org", userId: "owner", role: "owner", teams: [] });
  const verify = vi.fn().mockResolvedValue({ model: "verifier", items: [{ item: "entity:a", representation: "entity", entityKind: "person", support: "explicit", usefulness: "useful", conflict: false, evidence: "A leads the team.", reason: "Explicit role" }] });
  const accept = vi.fn();
  const reject = vi.fn();
  const saveAssessment = vi.fn().mockImplementation(async (_org, _id, assessment) => ({ ...candidate, assessment }));
  const findByChunkId = vi.fn().mockResolvedValue(candidate);
  const existingKnowledge = vi.fn().mockResolvedValue([]);
  const deferIdentityResolution = vi.fn();
  const findSource = vi.fn().mockResolvedValue({ document: { status: "ready", scope: candidate.scope, createdBy: "owner", title: "People" }, chunk: { content: "A leads the team." } });
  const run = buildCurateKnowledgeCandidate({
    candidates: { findByChunkId, saveAssessment, deferIdentityResolution },
    documents: { findChunkById: findSource },
    access: { findByUser }, graph: { findNodesForScope: existingKnowledge },
    ontology: { findByOrganization: vi.fn().mockResolvedValue(null) }, verification: { verify }, accept, reject, clock: () => now
  });
  return { run, findSource, findByUser, verify, accept, reject, saveAssessment, findByChunkId, existingKnowledge, deferIdentityResolution };
}
describe("automatic curation orchestration", () => {
  it.each(["before", "during"])("retains organization-agent scope restrictions %s verification", async (timing) => {
    const test = setup();
    const scope = { organizationId: "org", kind: "user", userId: "owner" };
    const privateSource = { document: { status: "ready", scope }, chunk: { content: "A leads the team." } };
    if (timing === "before") {
      test.findByChunkId.mockResolvedValue({ ...candidate, scope });
      test.findSource.mockResolvedValue(privateSource);
    } else test.findSource.mockResolvedValueOnce({ document: { status: "ready", scope: candidate.scope }, chunk: { content: "A leads the team." } }).mockResolvedValue(privateSource);
    await test.run("org", "ch", "owner", "organization-agent");
    expect(test.verify).toHaveBeenCalledTimes(timing === "before" ? 0 : 1);
    expect(test.saveAssessment).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
  });

  it("reassesses pending extraction when its saved policy is obsolete", async () => {
    const test = setup();
    test.findByChunkId.mockResolvedValue({ ...candidate,assessment:{ model:"old",policyVersion:"evidence-v5",assessedAt:now.toISOString(),
      items:[{ item:"entity:a",verdict:"accept",evidence:"A leads the team.",reason:"Old policy." }] } });
    await test.run("org","ch", "owner");
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.saveAssessment).toHaveBeenCalledWith("org","c",expect.objectContaining({ policyVersion:"evidence-v7" }));
  });
  it("bounds accumulated context without truncating the source under verification", async () => {
    const test = setup();
    test.existingKnowledge.mockResolvedValue([{ id: "context-node", canonicalName: "A", aliases: [], sources: [{ chunkId: "context-source" }], kind: "person", summary: "x".repeat(10_000) }]);
    await test.run("org", "ch", "owner");
    expect(test.verify.mock.calls[0]?.[0]).toMatchObject({
      content: "A leads the team.",
      existingKnowledge: [{ name: "A", summary: "x".repeat(2_000) }]
    });
    expect(test.saveAssessment.mock.calls[0]?.[2].sources).toEqual([{ chunkId: "ch" }, { chunkId: "context-source" }]);
    expect(test.saveAssessment.mock.calls[0]?.[2].contextNodeIds).toEqual(["context-node"]);
  });
  it.each([undefined, "user", "organization-agent"] as const)("verifies then persists its assessment before automatically accepting qualified facts for %s", async (principalKind) => {
    const test = setup();
    await test.run("org", "ch", "owner", principalKind);
    expect(test.accept.mock.calls[0]?.[0].principalKind).toBe(principalKind);
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.saveAssessment).toHaveBeenCalledOnce();
    expect(test.accept).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner" }), "c", expect.stringContaining("Automatic"), { entityKeys: ["a"], relationshipIndexes: [] });
    expect(test.reject).not.toHaveBeenCalled();
  });
  it("does not verify or mutate without a current principal allowed to manage the source", async () => {
    const test = setup();
    test.findByUser.mockResolvedValue(null);
    await test.run("org", "ch", "owner");
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
  });
  it("rechecks membership after AI verification", async () => {
    const test = setup();
    test.findByUser.mockResolvedValueOnce({ organizationId: "org", userId: "owner", role: "owner", teams: [] }).mockResolvedValueOnce(null);
    await test.run("org", "ch", "owner");
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.saveAssessment).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
    expect(test.reject).not.toHaveBeenCalled();
  });

  it("does not save assessment when the document broadens beyond the requester's current manage permission", async () => {
    const test = setup();
    const scope = { organizationId: "org", kind: "user", userId: "owner" };
    test.findByChunkId.mockResolvedValue({ ...candidate, scope });
    test.findSource.mockResolvedValueOnce({ document: { status: "ready", scope }, chunk: { content: "A leads the team." } })
      .mockResolvedValueOnce({ document: { status: "ready", scope: candidate.scope } });
    test.findByUser.mockResolvedValue({ organizationId: "org", userId: "owner", role: "member", teams: [] });
    await test.run("org", "ch", "owner");
    expect(test.verify).toHaveBeenCalledOnce();
    expect(test.saveAssessment).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
  });

  it("leaves a team writer's extracted candidates for a manager to review", async () => {
    const test = setup();
    test.findByChunkId.mockResolvedValue({ ...candidate, scope: { organizationId: "org", kind: "team", teamId: "team" } });
    test.findByUser.mockResolvedValue({ organizationId: "org", userId: "owner", role: "member", teams: [{ teamId: "team", role: "member" }] });
    test.findSource.mockResolvedValue({ document: { status: "ready", scope: { organizationId: "org", kind: "team", teamId: "team" } } });
    await test.run("org", "ch", "owner");
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.accept).not.toHaveBeenCalled();
    expect(test.reject).not.toHaveBeenCalled();
  });
  it("fails closed when verification fails", async () => {
    const test = setup();
    test.verify.mockRejectedValue(new Error("provider unavailable"));
    await expect(test.run("org", "ch", "owner")).rejects.toThrow("provider unavailable");
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
    await test.run("org", "ch", "owner");
    expect(test.verify).not.toHaveBeenCalled();
  });
});
