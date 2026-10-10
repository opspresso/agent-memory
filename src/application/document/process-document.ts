import {
  createDocumentChunk,
  InvalidDocumentError,
  type DocumentChunk
} from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type {
  DocumentObjectStorage,
  DocumentTextExtractor
} from "@/domain/document/document-services";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import type { AiRequestQuotaKey } from "@/domain/shared/ai-request-limiter";
import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";
import { canAccessScopedResource } from "@/domain/identity/organization-access";
import { sameScope } from "@/domain/identity/scope-coverage";

import { chunkDocumentText } from "./chunk-text";
import { DocumentAccessDeniedError } from "./upload-document";

const documentEmbeddingBatchSize = 64;

export interface ProcessDocumentDependencies {
  readonly accessRepository: Pick<OrganizationAccessRepository, "findByUser">;
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly objectStorage: DocumentObjectStorage;
  readonly repository: Pick<DocumentRepository, "findById" | "claimForProcessing" | "completeProcessing" | "failProcessing">;
  readonly textExtractor: DocumentTextExtractor;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof InvalidDocumentError
    ? error.message.slice(0, 2_000)
    : "document processing failed";
}

async function embedDocumentParts(
  embeddingService: TextEmbeddingService,
  texts: readonly string[],
  quotaKey: AiRequestQuotaKey,
  authorize: () => Promise<void>
) {
  const embeddings = [];
  for (let offset = 0; offset < texts.length; offset += documentEmbeddingBatchSize) {
    await authorize();
    embeddings.push(
      ...(await embeddingService.embedMany(
        texts.slice(offset, offset + documentEmbeddingBatchSize),
        quotaKey
      ))
    );
  }
  return embeddings;
}

export function buildProcessDocument(dependencies: ProcessDocumentDependencies) {
  return async function execute(
    organizationId: string,
    documentId: string,
    generation: string,
    requestedBy: string
  ): Promise<void> {
    const startedAt = dependencies.clock();
    const claim = await dependencies.repository.claimForProcessing(organizationId, documentId, startedAt, generation);
    if (!claim) {
      return;
    }
    const { document } = claim;
    async function authorize() {
      const [current, access] = await Promise.all([
        dependencies.repository.findById(organizationId, documentId),
        dependencies.accessRepository.findByUser(organizationId, requestedBy)
      ]);
      if (!current || current.status !== "processing" || current.processingGeneration !== generation ||
          current.processingAttempts !== document.processingAttempts || !sameScope(current.scope, document.scope)) {
        throw new Error("document processing claim was lost");
      }
      if (!access || !canAccessScopedResource(access, "write", current.scope)) throw new DocumentAccessDeniedError();
    }

    try {
      await authorize();
      const content = await dependencies.objectStorage.get(document.objectKey);
      const extracted = await dependencies.textExtractor.extract(
        content,
        document.mimeType
      );
      const parts = chunkDocumentText(extracted.text, extracted.mimeType);
      if (parts.length === 0) {
        throw new InvalidDocumentError("document contains no extractable text");
      }
      const embeddings = dependencies.embeddingService
        ? await embedDocumentParts(
            dependencies.embeddingService,
            parts.map((part) => part.content),
            {
              organizationId,
              userId: requestedBy
            },
            authorize
          )
        : [];
      if (
        dependencies.embeddingService &&
        embeddings.length !== parts.length
      ) {
        throw new Error("embedding result count does not match document chunks");
      }
      await authorize();
      const completedAt = dependencies.clock();
      const chunks: DocumentChunk[] = parts.map((part, ordinal) =>
        createDocumentChunk({
          id: dependencies.generateId(),
          organizationId,
          documentId,
          ordinal,
          content: part.content,
          ...(embeddings[ordinal]
            ? { embedding: embeddings[ordinal] }
            : {}),
          metadata: { textMimeType: extracted.mimeType, start: part.start, end: part.end, ...(part.contextSpans ? { contextSpans: part.contextSpans } : {}) },
          now: completedAt
        })
      );
      await dependencies.repository.completeProcessing(
        claim,
        chunks,
        completedAt
      );
    } catch (error) {
      try {
        await dependencies.repository.failProcessing(
          claim,
          safeErrorMessage(error),
          dependencies.clock()
        );
      } catch (statusError) {
        throw new AggregateError(
          [error, statusError],
          "document processing and failure status update both failed"
        );
      }
      throw error;
    }
  };
}
