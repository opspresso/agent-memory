import {
  createDocumentChunk,
  InvalidDocumentError,
  maxDocumentChunks,
  type DocumentChunk
} from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type {
  DocumentObjectStorage,
  DocumentTextExtractor
} from "@/domain/document/document-services";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import type { AiRequestQuotaKey } from "@/domain/shared/ai-request-limiter";

import { chunkDocumentText } from "./chunk-text";

const documentEmbeddingBatchSize = 64;

export interface ProcessDocumentDependencies {
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly objectStorage: DocumentObjectStorage;
  readonly repository: DocumentRepository;
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
  quotaKey: AiRequestQuotaKey
) {
  const embeddings = [];
  for (let offset = 0; offset < texts.length; offset += documentEmbeddingBatchSize) {
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
    expectedAttempts?: number
  ): Promise<void> {
    const startedAt = dependencies.clock();
    const claim = expectedAttempts === undefined
      ? await dependencies.repository.claimForProcessing(organizationId, documentId, startedAt)
      : await dependencies.repository.claimForProcessing(organizationId, documentId, startedAt, expectedAttempts);
    if (!claim) {
      return;
    }
    const { document } = claim;

    try {
      const content = await dependencies.objectStorage.get(document.objectKey);
      const text = await dependencies.textExtractor.extract(
        content,
        document.mimeType
      );
      const parts = chunkDocumentText(text, document.mimeType);
      if (parts.length === 0) {
        throw new InvalidDocumentError("document contains no extractable text");
      }
      if (parts.length > maxDocumentChunks) {
        throw new InvalidDocumentError(
          `document exceeds the ${maxDocumentChunks} chunk processing limit`
        );
      }
      const embeddings = dependencies.embeddingService
        ? await embedDocumentParts(
            dependencies.embeddingService,
            parts.map((part) => part.content),
            {
              organizationId,
              userId: document.createdBy
            }
          )
        : [];
      if (
        dependencies.embeddingService &&
        embeddings.length !== parts.length
      ) {
        throw new Error("embedding result count does not match document chunks");
      }
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
          metadata: { start: part.start, end: part.end },
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
