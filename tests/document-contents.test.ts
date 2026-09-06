import { describe, expect, it, vi } from "vitest";
import { buildListDocumentChunks } from "@/application/document/list-document-chunks";
import { createDocument, type Document } from "@/domain/document/document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
const access: OrganizationAccess = { organizationId: "org", userId: "user", role: "member", teams: [] };
const now = new Date("2026-09-01T00:00:00Z");
const document: Document = { ...createDocument({ id: "doc", scope: { kind: "organization", organizationId: "org" }, title: "Source", objectKey: "private", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 8, createdBy: "user", now }), status: "ready" };
const chunks = [0, 1, 2].map((ordinal) => ({ id: `chunk-${ordinal}`, ordinal, organizationId: "org", documentId: "doc", content: `Passage ${ordinal}`, metadata: {}, createdAt: now }));
describe("document contents", () => {
  it("returns a bounded ordered page and continuation without counting the entire document", async () => {
    const readChunks = vi.fn().mockResolvedValue({ document, chunks });
    expect(await buildListDocumentChunks({ readChunks })(access, "doc", 2, 0)).toEqual({ document, chunks: chunks.slice(0, 2), nextOffset: 2 });
    expect(readChunks).toHaveBeenCalledWith({ access, documentId: "doc", limit: 3, offset: 0 });
    readChunks.mockResolvedValue({ document, chunks: [] });
    expect(await buildListDocumentChunks({ readChunks })(access, "doc", 2, 20)).toEqual({ document, chunks: [], nextOffset: null });
  });
  it.each(["pending", "processing", "failed", "archived"])("rejects %s sources", async (status) => {
    const readChunks = vi.fn().mockResolvedValue({ document: { ...document, status }, chunks });
    await expect(buildListDocumentChunks({ readChunks })(access, "doc")).rejects.toThrow("not found");
  });
  it("rejects missing, private and foreign sources even if the adapter returns them", async () => {
    const readChunks = vi.fn();
    const execute = buildListDocumentChunks({ readChunks });
    for (const result of [null, { document: { ...document, scope: { kind: "user", organizationId: "org", userId: "other" } }, chunks }, { document: { ...document, scope: { kind: "organization", organizationId: "other" } }, chunks }]) {
      readChunks.mockResolvedValue(result);
      await expect(execute(access, "doc")).rejects.toThrow("not found");
    }
  });
  it.each([[0, 0], [101, 0], [25, -1], [25, NaN], [25, Number.MAX_SAFE_INTEGER]])("rejects invalid pagination %s/%s before reading", async (limit, offset) => {
    const readChunks = vi.fn();
    await expect(buildListDocumentChunks({ readChunks })(access, "doc", limit, offset)).rejects.toThrow("pagination");
    expect(readChunks).not.toHaveBeenCalled();
  });
});
