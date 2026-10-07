import type { DocumentTextMimeType } from "./document-format";

export const documentProcessingLeaseMilliseconds = 15 * 60 * 1_000;

export type DocumentQueueEnqueueResult = "queued" | "already_queued";

export interface DocumentObjectStorage {
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface DocumentIngestionQueue {
  enqueue(
    organizationId: string,
    documentId: string,
    expectedAttempts?: number
  ): Promise<DocumentQueueEnqueueResult>;
}

export interface DocumentTextExtractor {
  extract(content: Uint8Array, mimeType: string): Promise<ExtractedDocumentText>;
}

export interface ExtractedDocumentText {
  readonly text: string;
  readonly mimeType: DocumentTextMimeType;
}

export interface DocumentKnowledgeEnrichmentQueue {
  enqueueKnowledgeEnrichment(
    organizationId: string,
    chunkId: string,
    requestedBy?: string,
    priority?: number
  ): Promise<DocumentQueueEnqueueResult>;
}
