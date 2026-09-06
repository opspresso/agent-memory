import { describe, expect, it, vi } from "vitest";
import { buildListDocuments } from "@/application/document/list-documents";
import { buildListMemories } from "@/application/memory/list-memories";
import { buildGetDocumentChunk } from "@/application/document/get-document-chunk";
import { createDocument, type Document } from "@/domain/document/document";
import { createMemory } from "@/domain/memory/memory";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

const now = new Date("2026-09-01T00:00:00Z");
const access: OrganizationAccess = { organizationId: "org", userId: "user", role: "member", teams: [] };
const scope = { kind: "organization" as const, organizationId: "org" };
function document(status: Document["status"] = "ready"): Document {
  return { ...createDocument({ id: "doc", scope, title: "Runbook", objectKey: "private-object", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 8, createdBy: "user", now }), status };
}
const memory = createMemory({ id: "memory", kind: "fact", scope, title: "Fact", content: "Evidence", source: { type: "user" }, createdBy: "user", validFrom: now, now });

describe("library reads", () => {
  it("paginates visible processing documents without admitting archived or foreign resources", async () => {
    const list = vi.fn().mockResolvedValue([document("pending"), document("failed"), document("archived"), { ...document(), scope: { kind: "organization", organizationId: "other" } }]);
    const page = await buildListDocuments({ list })(access, 1, 0);
    expect(page).toEqual({ documents: [document("pending")], nextOffset: 1 });
    expect(list).toHaveBeenCalledWith({ access, limit: 2, offset: 0 });
  });

  it("rechecks memory access and validity for browse results", async () => {
    const list = vi.fn().mockResolvedValue([memory, { ...memory, status: "archived" }, { ...memory, expiresAt: now }, { ...memory, validFrom: new Date(now.getTime() + 1) }, { ...memory, scope: { kind: "user", organizationId: "org", userId: "other" } }]);
    expect(await buildListMemories({ list }, () => now)(access)).toEqual({ memories: [memory], nextOffset: null });
  });

  it.each([[0, 0], [101, 0], [1, -1], [1, Number.MAX_SAFE_INTEGER], [1.5, 0], [1, NaN]])("rejects invalid pagination %s/%s before repository reads", async (limit, offset) => {
    const list = vi.fn();
    await expect(buildListDocuments({ list })(access, limit, offset)).rejects.toThrow("pagination");
    await expect(buildListMemories({ list }, () => now)(access, limit, offset)).rejects.toThrow("pagination");
    expect(list).not.toHaveBeenCalled();
  });

  it("only returns chunks from a currently readable ready source", async () => {
    const chunk = { id: "chunk", organizationId: "org", documentId: "doc", ordinal: 0, content: "Original evidence", metadata: {}, createdAt: now };
    const findChunkById = vi.fn().mockResolvedValue({ document: document(), chunk });
    const get = buildGetDocumentChunk({ findChunkById });
    expect(await get(access, "chunk")).toEqual({ document: document(), chunk });
    expect(findChunkById).toHaveBeenCalledWith("org", "chunk");
    for (const status of ["pending", "processing", "failed", "archived"] as const) {
      findChunkById.mockResolvedValue({ document: document(status), chunk });
      await expect(get(access, "chunk")).rejects.toThrow("not found");
    }
    findChunkById.mockResolvedValue({ document: { ...document(), scope: { kind: "user", organizationId: "org", userId: "other" } }, chunk });
    await expect(get(access, "chunk")).rejects.toThrow("not found");
    findChunkById.mockResolvedValue(null);
    await expect(get(access, "chunk")).rejects.toThrow("not found");
  });
});
