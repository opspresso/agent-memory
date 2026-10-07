import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "@/domain/document/document";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/organization-authorization", () => ({ authorizeOrganizationRoute: mocks.authorize }));
vi.mock("@/lib/document-service", () => ({ uploadDocumentRecord: mocks.upload, searchDocumentRecords: vi.fn() }));
import { POST } from "@/app/api/documents/route";

const access = { organizationId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", role: "member", teams: [] };
const document = createDocument({ id: "00000000-0000-4000-8000-000000000003",
  scope: { kind: "user", organizationId: access.organizationId, userId: access.userId }, title: "Source",
  objectKey: "private/source", checksum: "a".repeat(64), mimeType: "application/pdf", sizeBytes: 10,
  createdBy: access.userId, now: new Date() });

function request(file: File) {
  const body = new FormData();
  body.set("scopeKind", "user");
  body.set("file", file);
  return new Request("https://memory.example.com/api/documents", { method: "POST", body });
}

describe("multipart document upload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, access, user: { id: access.userId } });
    mocks.upload.mockResolvedValue(document);
  });

  it("accepts PDF bytes with an inferred MIME and server-authorized scope", async () => {
    const bytes = await readFile(new URL("./fixtures/documents/sample.pdf", import.meta.url));
    const response = await POST(request(new File([bytes], "source.PDF", { type: "application/octet-stream" })));
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/api/documents/${document.id}`);
    expect(mocks.upload).toHaveBeenCalledWith({ access, scope: document.scope, title: "source.PDF",
      mimeType: "application/pdf", content: new Uint8Array(bytes) });
    expect(await response.json()).not.toHaveProperty("objectKey");
  });

  it("accepts browser Markdown uploads without a MIME declaration", async () => {
    expect((await POST(request(new File(["# 한글"], "source.md")))).status).toBe(202);
    expect(mocks.upload.mock.calls[0]?.[0]).toMatchObject({ mimeType: "text/markdown" });
  });

  it.each([["source.pdf", "text/html"], ["source.doc", "application/msword"], ["archive.zip", "application/zip"]])(
    "rejects conflicting or unsupported uploads: %s", async (name, type) => {
      expect((await POST(request(new File(["value"], name, { type })))).status).toBe(400);
      expect(mocks.upload).not.toHaveBeenCalled();
    });

  it("does not read or upload a file without authorization", async () => {
    mocks.authorize.mockResolvedValue({ authorized: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(new File(["value"], "source.pdf", { type: "application/pdf" })))).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
