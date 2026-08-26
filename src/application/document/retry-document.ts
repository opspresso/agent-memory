import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type { Document } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type { DocumentIngestionQueue } from "@/domain/document/document-services";

import { DocumentNotFoundError } from "./get-document";
import { DocumentAccessDeniedError } from "./upload-document";

export interface RetryDocumentDependencies {
  readonly queue: DocumentIngestionQueue;
  readonly repository: DocumentRepository;
}

export class DocumentNotRetryableError extends Error {
  constructor() {
    super("only failed documents can be retried");
    this.name = "DocumentNotRetryableError";
  }
}

export function buildRetryDocument(dependencies: RetryDocumentDependencies) {
  return async function execute(
    access: OrganizationAccess,
    documentId: string
  ): Promise<Document> {
    const document = await dependencies.repository.findById(
      access.organizationId,
      documentId
    );
    if (!document || document.status === "archived") {
      throw new DocumentNotFoundError();
    }
    if (!canAccessScopedResource(access, "write", document.scope)) {
      throw new DocumentAccessDeniedError();
    }
    if (document.status !== "failed") {
      throw new DocumentNotRetryableError();
    }

    await dependencies.queue.enqueue(access.organizationId, document.id);
    return document;
  };
}
