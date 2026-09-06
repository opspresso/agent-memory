import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), documents: vi.fn(), memories: vi.fn(), chunk: vi.fn(), contents: vi.fn() }));
vi.mock("@/lib/organization-authorization", () => ({ authorizeOrganizationRoute: mocks.authorize }));
vi.mock("@/lib/document-service", () => ({ listDocumentRecords: mocks.documents, getDocumentChunkRecord: mocks.chunk, listDocumentChunkRecords: mocks.contents }));
vi.mock("@/lib/memory-service", () => ({ listMemoryRecords: mocks.memories }));
import { GET as documents } from "@/app/api/organizations/[organizationSlug]/documents/library/route";
import { GET as memories } from "@/app/api/organizations/[organizationSlug]/memories/library/route";
import { GET as contents } from "@/app/api/organizations/[organizationSlug]/documents/[documentId]/chunks/route";
import { GET as chunk } from "@/app/api/organizations/[organizationSlug]/document-chunks/[chunkId]/route";
import { DocumentNotFoundError } from "@/application/document/get-document";
import { InvalidDocumentSearchError } from "@/application/document/search-documents";
import { createDocument } from "@/domain/document/document";
const access = { organizationId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", role: "member", teams: [] };
const context = { params: Promise.resolve({ organizationSlug: "example" }) };
const chunkContext = { params: Promise.resolve({ organizationSlug: "example", chunkId: "00000000-0000-4000-8000-000000000003" }) };
const contentsContext = { params: Promise.resolve({ organizationSlug: "example", documentId: "00000000-0000-4000-8000-000000000003" }) };
const request = (query = "") => new Request(`https://memory.example.com/api/organizations/example/documents/library${query}`);
describe("library HTTP routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, access, user: { id: access.userId } });
  });
  it("uses the authorized organization and bounded page parameters", async () => {
    mocks.documents.mockResolvedValue({ documents: [], nextOffset: 50 });
    expect(await (await documents(request("?limit=25&offset=25"), context)).json()).toEqual({ documents: [], count: 0, nextOffset: 50 });
    expect(mocks.documents).toHaveBeenCalledWith(access, 25, 25);
    mocks.memories.mockResolvedValue({ memories: [], nextOffset: null });
    expect(await (await memories(request(), context)).json()).toEqual({ memories: [], count: 0, nextOffset: null });
    expect(mocks.memories).toHaveBeenCalledWith(access, 25, 0);
  });
  it("stops before reading when organization authorization fails", async () => {
    mocks.authorize.mockResolvedValue({ authorized: false, response: new Response(null, { status: 403 }) });
    expect((await documents(request(), context)).status).toBe(403);
    expect((await memories(request(), context)).status).toBe(403);
    expect((await chunk(request(), chunkContext)).status).toBe(403);
    expect((await contents(request(), contentsContext)).status).toBe(403);
    expect(mocks.contents).not.toHaveBeenCalled();
    expect(mocks.documents).not.toHaveBeenCalled();
    expect(mocks.memories).not.toHaveBeenCalled();
    expect(mocks.chunk).not.toHaveBeenCalled();
  });
  it("maps invalid pagination and unavailable evidence to public errors", async () => {
    mocks.documents.mockRejectedValue(new InvalidDocumentSearchError("invalid library pagination"));
    expect((await documents(request("?limit=101"), context)).status).toBe(400);
    mocks.chunk.mockRejectedValue(new DocumentNotFoundError());
    expect((await chunk(request(), chunkContext)).status).toBe(404);
    expect((await chunk(request(), { params: Promise.resolve({ organizationSlug: "example", chunkId: "bad" }) })).status).toBe(400);
  });
  it("exposes original chunk text without storage keys or embeddings", async () => {
    const document = { ...createDocument({ id: "doc", scope: { kind: "organization", organizationId: access.organizationId }, title: "Evidence", objectKey: "private-object-key", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 8, createdBy: access.userId, now: new Date() }), status: "ready" };
    mocks.chunk.mockResolvedValue({ document, chunk: { id: "chunk", ordinal: 0, content: "Evidence text", metadata: {}, embedding: { values: [1] } } });
    const response = await chunk(request(), chunkContext);
    const body = await response.json();
    expect(body.chunk).toEqual({ id: "chunk", ordinal: 0, content: "Evidence text", metadata: {} });
    expect(body.document).not.toHaveProperty("objectKey");
    expect(JSON.stringify(body)).not.toContain("embedding");
  });
  it("paginates document contents and strips internal data", async () => {
    const document = { ...createDocument({ id: "doc", scope: { kind: "organization", organizationId: access.organizationId }, title: "Evidence", objectKey: "private-object-key", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 8, createdBy: access.userId, now: new Date() }), status: "ready" };
    mocks.contents.mockResolvedValue({ document, chunks: [{ id: "chunk", ordinal: 25, content: "Passage", metadata: {}, embedding: { values: [1] } }], nextOffset: 50 });
    const body = await (await contents(request("?limit=25&offset=25"), contentsContext)).json();
    expect(body.chunks).toEqual([{ id: "chunk", ordinal: 25, content: "Passage", metadata: {} }]);
    expect(body).toMatchObject({ count: 1, nextOffset: 50 });
    expect(body.document).not.toHaveProperty("objectKey");
    expect(mocks.contents).toHaveBeenCalledWith(access, "00000000-0000-4000-8000-000000000003", 25, 25);
    mocks.contents.mockRejectedValue(new DocumentNotFoundError());
    expect((await contents(request(), contentsContext)).status).toBe(404);
    mocks.contents.mockRejectedValue(new InvalidDocumentSearchError("invalid document chunk pagination"));
    expect((await contents(request("?limit=101"), contentsContext)).status).toBe(400);
    expect((await contents(request(), { params: Promise.resolve({ organizationSlug: "example", documentId: "bad" }) })).status).toBe(400);
  });

});
