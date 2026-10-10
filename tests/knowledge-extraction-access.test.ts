import { describe, expect, it, vi } from "vitest";
import { buildGenerateKnowledgeCandidate } from "@/application/knowledge/generate-knowledge-candidate";
import { createDocument, createDocumentChunk } from "@/domain/document/document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

const now = new Date("2026-10-10T00:00:00Z");
const owner: OrganizationAccess = { organizationId: "org", userId: "owner", role: "owner", teams: [] };

function fixture() {
  const document = { ...createDocument({ id: "doc", title: "Source", scope: { organizationId: "org", kind: "organization" },
    objectKey: "source", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 10, createdBy: "creator", now }), status: "ready" as const };
  const chunk = createDocumentChunk({ id: "chunk", documentId: "doc", organizationId: "org", ordinal: 0, content: "Atlas uses Orion.", now });
  const findChunkById = vi.fn().mockResolvedValue({ document, chunk });
  const findByUser = vi.fn().mockResolvedValue(owner);
  const extract = vi.fn().mockResolvedValue({ model: "model", graph: { entities: [], relationships: [] } });
  const save = vi.fn().mockImplementation(async (candidate) => candidate);
  const run = buildGenerateKnowledgeCandidate({
    accessRepository: { findByUser }, candidateRepository: { findByChunkId: vi.fn(), save },
    documentRepository: { findChunkById }, ontologyReader: { findByOrganization: vi.fn().mockResolvedValue(null) },
    extractionService: { extract }, clock: () => now, generateId: () => "candidate"
  });
  return { run, findByUser, findChunkById, extract, save, document, chunk };
}

describe("knowledge extraction authorization", () => {
  it.each([null, { ...owner, role: "member" as const }, { ...owner, organizationId: "other-org" }])(
    "does not send source content to AI without current manage access: %j", async (access) => {
      const test = fixture();
      test.findByUser.mockResolvedValue(access);
      expect(await test.run("org", "chunk", "owner")).toBeNull();
      expect(test.extract).not.toHaveBeenCalled();
      expect(test.save).not.toHaveBeenCalled();
    }
  );

  it("charges the current queue requester and uses the creator only for initial ingestion", async () => {
    const test = fixture();
    await test.run("org", "chunk", "owner");
    expect(test.findByUser).toHaveBeenCalledWith("org", "owner");
    expect(test.extract).toHaveBeenCalledWith(expect.objectContaining({ quotaKey: { organizationId: "org", userId: "owner" } }));
    test.findByUser.mockResolvedValue({ ...owner, userId: "creator" });
    await test.run("org", "chunk");
    expect(test.findByUser).toHaveBeenLastCalledWith("org", "creator");
    expect(test.extract).toHaveBeenLastCalledWith(expect.objectContaining({ quotaKey: { organizationId: "org", userId: "creator" } }));
  });

  it("lets a team writer extract their upload while reserving explicit retries for managers", async () => {
    const test = fixture();
    test.findByUser.mockResolvedValue({ ...owner, userId: "creator", role: "member", teams: [{ teamId: "team", role: "member" }] });
    test.findChunkById.mockResolvedValue({ document: { ...test.document, scope: { organizationId: "org", kind: "team", teamId: "team" } }, chunk: test.chunk });
    expect(await test.run("org", "chunk")).toMatchObject({ status: "pending" });
    expect(test.extract).toHaveBeenCalledOnce();
    test.extract.mockClear();
    expect(await test.run("org", "chunk", "creator")).toBeNull();
    expect(test.extract).not.toHaveBeenCalled();
  });

  it("does not persist extraction after the requester's membership is revoked", async () => {
    const test = fixture();
    test.findByUser.mockResolvedValueOnce(owner).mockResolvedValueOnce(null);
    expect(await test.run("org", "chunk", "owner")).toBeNull();
    expect(test.extract).toHaveBeenCalledOnce();
    expect(test.save).not.toHaveBeenCalled();
  });

  it.each(["archived", "private"])("does not persist extraction after its source becomes %s", async (change) => {
    const test = fixture();
    test.findChunkById.mockResolvedValueOnce({ document: test.document, chunk: test.chunk }).mockResolvedValueOnce({
      document: change === "archived" ? { ...test.document, status: "archived" } :
        { ...test.document, scope: { organizationId: "org", kind: "user", userId: "another-user" } }, chunk: test.chunk
    });
    expect(await test.run("org", "chunk", "owner")).toBeNull();
    expect(test.extract).toHaveBeenCalledOnce();
    expect(test.save).not.toHaveBeenCalled();
  });
});
