import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import {
  createDocument,
  type Document,
  type DocumentScope
} from "@/domain/document/document";
import type {
  DocumentRepository,
  DocumentUploadLimits,
  SaveDocumentResult
} from "@/domain/document/document-repository";
import type {
  DocumentIngestionQueue,
  DocumentObjectStorage
} from "@/domain/document/document-services";
import { IngestionConflictError, IngestionReplayError, type IngestionReceipt,
  type IngestionReceiptRepository } from "@/domain/shared/ingestion-receipt";

export interface UploadDocumentInput {
  readonly idempotencyKey?: string;
  readonly access: OrganizationAccess;
  readonly scope: DocumentScope;
  readonly title: string;
  readonly sourceUri?: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UploadDocumentDependencies {
  readonly receipts?: IngestionReceiptRepository;
  readonly fingerprint?: (input: unknown) => string;
  readonly checksum: (content: Uint8Array) => string;
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly objectStorage: DocumentObjectStorage;
  readonly limits: DocumentUploadLimits;
  readonly queue: DocumentIngestionQueue;
  readonly repository: DocumentRepository;
}

export class DocumentAccessDeniedError extends Error {
  constructor() {
    super("document access denied");
    this.name = "DocumentAccessDeniedError";
  }
}

export class DocumentQuotaExceededError extends Error {
  constructor(readonly reason: Exclude<SaveDocumentResult, "saved">) {
    super(reason);
    this.name = "DocumentQuotaExceededError";
  }
}

export function buildUploadDocument(dependencies: UploadDocumentDependencies) {
  return async function execute(input: UploadDocumentInput): Promise<Document> {
    if (!canAccessScopedResource(input.access, "write", input.scope)) {
      throw new DocumentAccessDeniedError();
    }

    const now = dependencies.clock();
    const identity = input.idempotencyKey ? { organizationId: input.access.organizationId, userId: input.access.userId,
      operation: "document.upload" as const, key: input.idempotencyKey } : undefined;
    if (identity && (!dependencies.receipts || !dependencies.fingerprint)) throw new Error("idempotent document upload is not configured");
    const checksum = dependencies.checksum(input.content);
    const payloadHash = identity ? dependencies.fingerprint!({ scope: input.scope, title: input.title,
      sourceUri: input.sourceUri, mimeType: input.mimeType, checksum, metadata: input.metadata ?? {} }) : undefined;
    const reuse = async (receipt: IngestionReceipt): Promise<Document> => {
      if (receipt.payloadHash !== payloadHash) throw new IngestionConflictError();
      const document = await dependencies.repository.findById(input.access.organizationId, receipt.resourceId);
      if (!document || document.status === "archived" || !canAccessScopedResource(input.access, "read", document.scope)) {
        throw new DocumentAccessDeniedError();
      }
      // Repair a crash between the resource transaction and queue publication.
      if (document.status === "pending") await dependencies.queue.enqueue(input.access.organizationId, document.id, document.processingAttempts);
      return document;
    };
    if (identity) {
      const previous = await dependencies.receipts!.find(identity);
      if (previous) return reuse(previous);
    }
    const documentId = dependencies.generateId();
    const objectKey = `organizations/${input.access.organizationId}/documents/${documentId}/source`;
    const document = createDocument({
      id: documentId,
      scope: input.scope,
      title: input.title,
      ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}),
      objectKey,
      checksum,
      mimeType: input.mimeType,
      sizeBytes: input.content.byteLength,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdBy: input.access.userId,
      now
    });

    await dependencies.objectStorage.put(
      document.objectKey,
      input.content,
      document.mimeType
    );
    try {
      const saved = identity
        ? await dependencies.repository.save(document, dependencies.limits,
          { ...identity, payloadHash: payloadHash!, resourceId: document.id, createdAt: now })
        : await dependencies.repository.save(document, dependencies.limits);
      if (saved !== "saved") {
        throw new DocumentQuotaExceededError(saved);
      }
    } catch (error) {
      if (identity) {
        // A failed COMMIT response does not prove rollback. Keep bytes if the
        // resource committed, or if the database cannot establish its outcome.
        const committed = await dependencies.receipts!.find(identity);
        if (committed?.resourceId === document.id) return reuse(committed);
      }
      try {
        await dependencies.objectStorage.delete(document.objectKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "document persistence and object cleanup both failed"
        );
      }
      if (error instanceof IngestionReplayError) return reuse(error.receipt);
      throw error;
    }

    try {
      if (identity) await dependencies.queue.enqueue(input.access.organizationId, document.id, document.processingAttempts);
      else await dependencies.queue.enqueue(input.access.organizationId, document.id);
    } catch (error) {
      try {
        await dependencies.repository.markEnqueueFailure(
          input.access.organizationId,
          document.id,
          "failed to enqueue document ingestion",
          now
        );
      } catch (statusError) {
        throw new AggregateError(
          [error, statusError],
          "document enqueue and failure status update both failed"
        );
      }
      return Object.freeze({
        ...document,
        status: "failed" as const,
        errorMessage: "document ingestion could not be queued",
        updatedAt: new Date(now)
      });
    }

    return document;
  };
}
