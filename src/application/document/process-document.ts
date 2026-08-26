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

import { chunkText } from "./chunk-text";

export interface ProcessDocumentDependencies {
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly objectStorage: DocumentObjectStorage;
  readonly repository: DocumentRepository;
  readonly textExtractor: DocumentTextExtractor;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 2_000)
    : "unknown document processing error";
}

export function buildProcessDocument(dependencies: ProcessDocumentDependencies) {
  return async function execute(
    organizationId: string,
    documentId: string
  ): Promise<void> {
    const startedAt = dependencies.clock();
    const document = await dependencies.repository.claimForProcessing(
      organizationId,
      documentId,
      startedAt
    );
    if (!document) {
      return;
    }

    try {
      const content = await dependencies.objectStorage.get(document.objectKey);
      const text = await dependencies.textExtractor.extract(
        content,
        document.mimeType
      );
      const parts = chunkText(text);
      if (parts.length === 0) {
        throw new InvalidDocumentError("document contains no extractable text");
      }
      const embeddings = dependencies.embeddingService
        ? await dependencies.embeddingService.embedMany(
            parts.map((part) => part.content)
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
        document,
        chunks,
        completedAt
      );
    } catch (error) {
      try {
        await dependencies.repository.failProcessing(
          organizationId,
          documentId,
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
