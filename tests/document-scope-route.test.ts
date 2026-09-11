import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), get: vi.fn(), change: vi.fn() }));
vi.mock("@/lib/organization-authorization", () => ({ authorizeOrganizationRoute: mocks.authorize }));
vi.mock("@/lib/document-service", () => ({ getDocumentRecord: mocks.get, changeDocumentScopeRecord: mocks.change, archiveDocumentRecord: vi.fn() }));
import { GET, PATCH } from "@/app/api/documents/[documentId]/route";
import { createDocument } from "@/domain/document/document";
import { DocumentRelatedScopeConflictError, DocumentScopeConflictError } from "@/application/document/change-document-scope";

const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ documentId: id }) };
const access = { organizationId: "organization", userId: "user", role: "owner", teams: [] };
const now = new Date("2026-09-11T00:00:00.000Z");
const document = { ...createDocument({ id, scope: { kind: "organization", organizationId: access.organizationId }, title: "Three Kingdoms", objectKey: "private", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 1, createdBy: access.userId, now }), status: "ready" };
const knowledge = { nodes: { updated: 2, unchanged: 0, skipped: 0 }, edges: { updated: 1, unchanged: 0, skipped: 0 }, skipped: [] };
const request = (etag: string | null = `"${now.toISOString()}"`, body: unknown = { scope: { kind: "organization" } }) => new Request(`https://memory.example.com/api/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) }, body: JSON.stringify(body) });

describe("document scope HTTP route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, access });
    mocks.get.mockResolvedValue(document);
    mocks.change.mockResolvedValue({ status: "changed", document, knowledge });
  });
  it("returns the ETag used for conditional changes and strips storage fields", async () => {
    const response = await GET(new Request("https://memory.example.com"), context);
    expect(response.headers.get("etag")).toBe(`"${now.toISOString()}"`);
    expect(await response.json()).not.toHaveProperty("objectKey");
    const result = await PATCH(request(), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ knowledge, document: { id } });
    expect(mocks.change).toHaveBeenCalledWith({ access, documentId: id, scope: { kind: "organization", organizationId: access.organizationId }, expectedUpdatedAt: now.toISOString() });
  });
  it("requires a valid precondition and rejects tenant/ownership input before mutation", async () => {
    expect((await PATCH(request(null), context)).status).toBe(428);
    expect((await PATCH(request("*"), context)).status).toBe(400);
    expect((await PATCH(request(undefined, { scope: { kind: "user", userId: id } }), context)).status).toBe(400);
    expect(mocks.change).not.toHaveBeenCalled();
  });
  it("resolves user scope to the authenticated user", async () => {
    await PATCH(request(undefined, { scope: { kind: "user" } }), context);
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: "user", organizationId: access.organizationId, userId: access.userId } }));
  });
  it("honors authorization denial and reports a lost precondition", async () => {
    mocks.authorize.mockResolvedValueOnce({ authorized: false, response: new Response(null, { status: 403 }) });
    expect((await PATCH(request(), context)).status).toBe(403);
    expect(mocks.change).not.toHaveBeenCalled();
    mocks.change.mockRejectedValueOnce(new DocumentScopeConflictError());
    expect((await PATCH(request(), context)).status).toBe(412);
  });
  it("distinguishes unsafe scope restrictions from stale document state", async () => {
    mocks.change.mockRejectedValueOnce(new DocumentRelatedScopeConflictError());
    const response = await PATCH(request(undefined, { scope: { kind: "user" } }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "related_scope_conflict" });
  });
});
