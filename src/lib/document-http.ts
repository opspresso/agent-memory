import { DocumentNotFoundError } from "@/application/document/get-document";
import { DocumentNotRetryableError } from "@/application/document/retry-document";
import { InvalidDocumentSearchError } from "@/application/document/search-documents";
import { DocumentAccessDeniedError } from "@/application/document/upload-document";
import { InvalidDocumentError, type Document } from "@/domain/document/document";
import type { DocumentSearchHit } from "@/domain/document/document-repository";

export const maxDocumentBytes = 10 * 1_024 * 1_024;
export const maxDocumentRequestBytes = maxDocumentBytes + 64 * 1_024;

export function documentErrorResponse(error: unknown): Response | null {
  if (error instanceof DocumentNotFoundError) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  if (error instanceof DocumentAccessDeniedError) {
    return Response.json({ error: "Document access denied" }, { status: 403 });
  }
  if (error instanceof DocumentNotRetryableError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (
    error instanceof InvalidDocumentError ||
    error instanceof InvalidDocumentSearchError
  ) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
}

export function publicDocument(document: Document) {
  return {
    id: document.id,
    scope: document.scope,
    title: document.title,
    ...(document.sourceUri ? { sourceUri: document.sourceUri } : {}),
    checksum: document.checksum,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    metadata: document.metadata,
    createdBy: document.createdBy,
    processingAttempts: document.processingAttempts,
    ...(document.status === "failed" && document.errorMessage
      ? { processingError: document.errorMessage }
      : {}),
    ...(document.processingStartedAt
      ? { processingStartedAt: document.processingStartedAt }
      : {}),
    ...(document.processedAt ? { processedAt: document.processedAt } : {}),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

export function publicDocumentHit(hit: DocumentSearchHit) {
  return {
    document: publicDocument(hit.document),
    chunk: {
      id: hit.chunk.id,
      ordinal: hit.chunk.ordinal,
      content: hit.chunk.content,
      metadata: hit.chunk.metadata
    },
    lexicalScore: hit.lexicalScore,
    vectorScore: hit.vectorScore,
    score: hit.score
  };
}

export function parseMetadata(value: FormDataEntryValue | null):
  | Readonly<{ valid: true; value?: Readonly<Record<string, unknown>> }>
  | Readonly<{ valid: false }> {
  if (value === null || value === "") {
    return { valid: true };
  }
  if (typeof value !== "string") {
    return { valid: false };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return { valid: false };
    }
    return {
      valid: true,
      value: parsed as Readonly<Record<string, unknown>>
    };
  } catch {
    return { valid: false };
  }
}
