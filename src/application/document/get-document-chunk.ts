import { canAccessScopedResource, type OrganizationAccess } from "@/domain/identity/organization-access";
import type { DocumentRepository } from "@/domain/document/document-repository";
import { DocumentNotFoundError } from "./get-document";

export function buildGetDocumentChunk(repository: Pick<DocumentRepository, "findChunkById">) {
  return async (access: OrganizationAccess, chunkId: string) => {
    const record = await repository.findChunkById(access.organizationId, chunkId);
    if (!record || record.document.status !== "ready" || !canAccessScopedResource(access, "read", record.document.scope)) {
      throw new DocumentNotFoundError();
    }
    return record;
  };
}
