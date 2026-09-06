import { canAccessScopedResource, type OrganizationAccess } from "@/domain/identity/organization-access";
import type { DocumentLibraryReader } from "@/domain/document/document-repository";
import { InvalidDocumentSearchError } from "./search-documents";

export function buildListDocuments(repository: DocumentLibraryReader) {
  return async (access: OrganizationAccess, limit = 25, offset = 0) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - 101) {
      throw new InvalidDocumentSearchError("invalid library pagination");
    }
    const rows = await repository.list({ access, limit: limit + 1, offset });
    const readable = rows.filter((document) => document.status !== "archived" && canAccessScopedResource(access, "read", document.scope));
    return { documents: readable.slice(0, limit), nextOffset: readable.length > limit ? offset + limit : null };
  };
}
