import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { InvalidDocumentError } from "@/domain/document/document";
import { withRouteErrorBoundary } from "@/lib/route-error-boundary";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), upload: vi.fn(), candidates: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/organization-authorization", () => ({ authorizeOrganizationRoute: mocks.authorize }));
vi.mock("@/lib/document-service", () => ({ uploadDocumentRecord: mocks.upload, searchDocumentRecords: vi.fn() }));
vi.mock("@/lib/knowledge-candidate-service", () => ({ listKnowledgeCandidateRecords: mocks.candidates }));
vi.mock("@/lib/observability", () => ({ logger: { error: mocks.error } }));
import { POST as upload } from "@/app/api/documents/route";
import { GET as candidates } from "@/app/api/knowledge/candidates/route";

const sentinel = "private-document-sentinel";
const access = { organizationId: "org", userId: "user", role: "owner", teams: [] };
function databaseError() {
  return new DrizzleQueryError("insert into documents values ($1)", [sentinel],
    Object.assign(new Error(`driver detail ${sentinel}`), { code: "23503" }));
}

describe("API error privacy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ authorized: true, access, user: { id: "user" } });
  });

  async function expectSafeFailure(response: Response) {
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(sentinel);
    expect(JSON.stringify(mocks.error.mock.calls)).toContain("23503");
  }

  it("does not let document write errors escape to the framework logger", async () => {
    mocks.upload.mockRejectedValue(databaseError());
    const body = new FormData();
    body.set("scopeKind", "organization");
    body.set("file", new File([sentinel], "source.txt", { type: "text/plain" }));
    await expectSafeFailure(await upload(new Request("https://memory.test/api/documents", { method: "POST", body })));
  });

  it.each(["authorization", "repository"])("contains %s failures during Knowledge reads", async (stage) => {
    (stage === "authorization" ? mocks.authorize : mocks.candidates).mockRejectedValue(databaseError());
    await expectSafeFailure(await candidates(new Request(`https://memory.test/api/knowledge/candidates?q=${sentinel}`)));
  });

  it("preserves a domain error translated by the route", async () => {
    mocks.upload.mockRejectedValue(new InvalidDocumentError("unsupported document MIME type"));
    const body = new FormData();
    body.set("scopeKind", "organization");
    body.set("file", new File(["text"], "source.txt", { type: "text/plain" }));
    const response = await upload(new Request("https://memory.test/api/documents", { method: "POST", body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsupported document MIME type" });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("preserves response identity, body, cookies and redirect headers", async () => {
    const expected = new Response("response body", { status: 303, headers: { Location: "/documents", "Set-Cookie": "session=test; HttpOnly" } });
    const handler = withRouteErrorBoundary("POST /api/test", async (_request: Request, context: { id: string }) => {
      expect(context.id).toBe("context-id");
      return expected;
    });
    const actual = await handler(new Request("https://memory.test/api/test"), { id: "context-id" });
    expect(actual).toBe(expected);
    expect(await actual.text()).toBe("response body");
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("lets Next.js handle its own redirect control flow", async () => {
    const handler = withRouteErrorBoundary("GET /api/test", async () => redirect("/login"));
    await expect(handler()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
