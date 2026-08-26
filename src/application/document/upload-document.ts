import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import {
  createDocument,
  type Document,
  type DocumentScope
} from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type {
  DocumentIngestionQueue,
  DocumentObjectStorage
} from "@/domain/document/document-services";

export interface UploadDocumentInput {
  readonly access: OrganizationAccess;
  readonly scope: DocumentScope;
  readonly title: string;
  readonly sourceUri?: string;
  readonly mimeType: string;
  readonly content: Uint8Array;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface UploadDocumentDependencies {
  readonly checksum: (content: Uint8Array) => string;
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly objectStorage: DocumentObjectStorage;
  readonly queue: DocumentIngestionQueue;
  readonly repository: DocumentRepository;
}

export class DocumentAccessDeniedError extends Error {
  constructor() {
    super("document access denied");
    this.name = "DocumentAccessDeniedError";
  }
}

export function buildUploadDocument(dependencies: UploadDocumentDependencies) {
  return async function execute(input: UploadDocumentInput): Promise<Document> {
    if (!canAccessScopedResource(input.access, "write", input.scope)) {
      throw new DocumentAccessDeniedError();
    }

    const now = dependencies.clock();
    const documentId = dependencies.generateId();
    const objectKey = `organizations/${input.access.organizationId}/documents/${documentId}/source`;
    const document = createDocument({
      id: documentId,
      scope: input.scope,
      title: input.title,
      ...(input.sourceUri ? { sourceUri: input.sourceUri } : {}),
      objectKey,
      checksum: dependencies.checksum(input.content),
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
      await dependencies.repository.save(document);
    } catch (error) {
      try {
        await dependencies.objectStorage.delete(document.objectKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "document persistence and object cleanup both failed"
        );
      }
      throw error;
    }

    try {
      await dependencies.queue.enqueue(
        input.access.organizationId,
        document.id
      );
    } catch (error) {
      try {
        await dependencies.repository.failProcessing(
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
      throw error;
    }

    return document;
  };
}
