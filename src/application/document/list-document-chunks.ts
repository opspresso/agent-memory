import { canAccessScopedResource, type OrganizationAccess } from "@/domain/identity/organization-access";
import type { DocumentChunkPageReader } from "@/domain/document/document-repository";
import { DocumentNotFoundError } from "./get-document";
import { InvalidDocumentSearchError } from "./search-documents";

export function buildListDocumentChunks(repository: DocumentChunkPageReader) {
  return async (access: OrganizationAccess, documentId: string, limit = 25, offset = 0) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - 101) {
      throw new InvalidDocumentSearchError("invalid document chunk pagination");
    }
    const page = await repository.readChunks({ access, documentId, limit: limit + 1, offset });
    if (!page || page.document.status !== "ready" || !canAccessScopedResource(access, "read", page.document.scope)) {
      throw new DocumentNotFoundError();
    }
    return { document: page.document, chunks: page.chunks.slice(0, limit), nextOffset: page.chunks.length > limit ? offset + limit : null };
  };
}
