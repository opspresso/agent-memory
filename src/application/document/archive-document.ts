import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type { DocumentRepository } from "@/domain/document/document-repository";

import { DocumentNotFoundError } from "./get-document";
import { DocumentAccessDeniedError } from "./upload-document";

interface ArchiveDocumentDependencies {
  readonly clock: () => Date;
  readonly repository: DocumentRepository;
}

export function buildArchiveDocument(
  dependencies: ArchiveDocumentDependencies
) {
  return async function execute(
    access: OrganizationAccess,
    documentId: string
  ): Promise<void> {
    const document = await dependencies.repository.findById(
      access.organizationId,
      documentId
    );
    if (!document || document.status === "archived") {
      throw new DocumentNotFoundError();
    }
    if (!canAccessScopedResource(access, "manage", document.scope)) {
      throw new DocumentAccessDeniedError();
    }
    const archived = await dependencies.repository.archive(
      access.organizationId,
      documentId,
      dependencies.clock(),
      document.scope
    );
    if (!archived) {
      throw new DocumentNotFoundError();
    }
  };
}
