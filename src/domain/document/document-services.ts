import type { DocumentTextMimeType } from "./document-format";
import type { KnowledgeExtractionPrincipal } from "../knowledge/knowledge-extraction-service";

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
    generation: string,
    requestedBy: string
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
    principal: KnowledgeExtractionPrincipal,
    priority?: number
  ): Promise<DocumentQueueEnqueueResult>;
}
