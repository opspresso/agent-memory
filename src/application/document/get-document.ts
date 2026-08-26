import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type { Document } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";

export class DocumentNotFoundError extends Error {
  constructor() {
    super("document not found");
    this.name = "DocumentNotFoundError";
  }
}

export function buildGetDocument(repository: DocumentRepository) {
  return async function execute(
    access: OrganizationAccess,
    documentId: string
  ): Promise<Document> {
    const document = await repository.findById(
      access.organizationId,
      documentId
    );
    if (
      !document ||
      document.status === "archived" ||
      !canAccessScopedResource(access, "read", document.scope)
    ) {
      throw new DocumentNotFoundError();
    }

    return document;
  };
}
