import { describe, expect, it, vi } from "vitest";
import { buildChangeDocumentScope, DocumentScopeConflictError, DocumentScopeNotReadyError } from "@/application/document/change-document-scope";
import { DocumentAccessDeniedError } from "@/application/document/upload-document";
import { DocumentNotFoundError } from "@/application/document/get-document";
import { documentErrorResponse, documentScopeEtag, parseDocumentScopeEtag } from "@/lib/document-http";
import { changeDocumentScopeSchema } from "@/lib/document-schemas";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

const now = new Date("2026-09-11T00:00:00.000Z");
const access: OrganizationAccess = { organizationId: "org", userId: "user", role: "owner", teams: [] };
const input = { access, documentId: "document", scope: { kind: "organization" as const, organizationId: "org" }, expectedUpdatedAt: now.toISOString() };

describe("document scope boundary", () => {
  it("rejects organization sharing by an ordinary member before persistence", async () => {
    const changeScope = vi.fn();
    const change = buildChangeDocumentScope({ repository: { changeScope }, clock: () => now });
    await expect(change({ ...input, access: { ...access, role: "member" } })).rejects.toBeInstanceOf(DocumentAccessDeniedError);
    expect(changeScope).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", DocumentNotFoundError, 404], ["access_denied", DocumentAccessDeniedError, 403],
    ["conflict", DocumentScopeConflictError, 412], ["not_ready", DocumentScopeNotReadyError, 409]
  ] as const)("maps repository %s to the public error", async (status, error, code) => {
    const change = buildChangeDocumentScope({ repository: { changeScope: vi.fn().mockResolvedValue({ status }) }, clock: () => now });
    await expect(change(input)).rejects.toBeInstanceOf(error);
    expect(documentErrorResponse(new error())?.status).toBe(code);
  });

  it("accepts only a single strong timestamp ETag", () => {
    expect(parseDocumentScopeEtag(documentScopeEtag({ updatedAt: now }))).toBe(now.toISOString());
    for (const invalid of ["*", 'W/"2026-09-11T00:00:00.000Z"', '"2026-02-31T00:00:00.000Z"', '"invalid"', '"a", "b"']) expect(parseDocumentScopeEtag(invalid)).toBeNull();
  });

  it("rejects tenant input, ownership transfer, and ambiguous scope fields", () => {
    expect(changeDocumentScopeSchema.safeParse({ scope: { kind: "organization" } }).success).toBe(true);
    expect(changeDocumentScopeSchema.safeParse({ scope: { kind: "user" } }).success).toBe(true);
    for (const body of [{ organizationId: "org", scope: { kind: "organization" } }, { scope: { kind: "organization", teamId: "team" } }, { scope: { kind: "user", userId: "someone" } }, { scope: { kind: "team" } }]) expect(changeDocumentScopeSchema.safeParse(body).success).toBe(false);
  });
});
