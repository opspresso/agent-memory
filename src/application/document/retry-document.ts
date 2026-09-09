import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type { Document } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type { DocumentIngestionQueue } from "@/domain/document/document-services";
import { IngestionConflictError, IngestionReplayError, type IngestionReceiptRepository } from "@/domain/shared/ingestion-receipt";

import { DocumentNotFoundError } from "./get-document";
import { DocumentAccessDeniedError } from "./upload-document";

export interface RetryDocumentDependencies {
  readonly receipts?: IngestionReceiptRepository;
  readonly fingerprint?: (input: unknown) => string;
  readonly clock?: () => Date;
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
    documentId: string,
    request?: { idempotencyKey: string; expectedAttempts: number }
  ): Promise<Document> {
    let document = await dependencies.repository.findById(
      access.organizationId,
      documentId
    );
    if (!document || document.status === "archived") {
      throw new DocumentNotFoundError();
    }
    if (!canAccessScopedResource(access, "write", document.scope)) {
      throw new DocumentAccessDeniedError();
    }
    if (request) {
      if (!dependencies.receipts || !dependencies.fingerprint || !dependencies.clock || !dependencies.repository.prepareRetry) {
        throw new Error("idempotent document retry is not configured");
      }
      const identity = { organizationId: access.organizationId, userId: access.userId,
        operation: "document.retry" as const, key: request.idempotencyKey };
      const payloadHash = dependencies.fingerprint({ documentId, expectedAttempts: request.expectedAttempts });
      const previous = await dependencies.receipts.find(identity);
      if (previous && previous.payloadHash !== payloadHash) throw new IngestionConflictError();
      if (!previous) {
        try {
          const prepared = await dependencies.repository.prepareRetry(document, request.expectedAttempts,
            { ...identity, payloadHash, resourceId: documentId, createdAt: dependencies.clock() });
          if (!prepared) throw new DocumentNotRetryableError();
        } catch (error) {
          const committed = error instanceof IngestionReplayError ? error.receipt : await dependencies.receipts.find(identity);
          if (!committed) throw error;
          if (committed.payloadHash !== payloadHash) throw new IngestionConflictError();
        }
      }
      document = await dependencies.repository.findById(access.organizationId, documentId);
      if (!document || document.status === "archived") throw new DocumentNotFoundError();
      if (!canAccessScopedResource(access, "write", document.scope)) throw new DocumentAccessDeniedError();
      if ((document.status === "pending" || document.status === "failed") && document.processingAttempts === request.expectedAttempts) {
        try {
          await dependencies.queue.enqueue(access.organizationId, document.id, request.expectedAttempts);
        } catch (error) {
          await dependencies.repository.markEnqueueFailure(access.organizationId, document.id, "failed to enqueue document retry", dependencies.clock());
          throw error;
        }
      }
      return document;
    }
    if (document.status !== "failed") {
      throw new DocumentNotRetryableError();
    }

    await dependencies.queue.enqueue(access.organizationId, document.id);
    return document;
  };
}
