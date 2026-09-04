import type { ScopedResource } from "@/domain/identity/organization-access";
import type { MemoryEmbedding } from "@/domain/memory/memory";

export const documentStatuses = [
  "pending",
  "processing",
  "ready",
  "failed",
  "archived"
] as const;

export const documentMimeTypes = [
  "application/json",
  "application/xml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/xml"
] as const;

export const maxDocumentChunks = 512;

export type DocumentStatus = (typeof documentStatuses)[number];
export type DocumentScope = ScopedResource;

export interface Document {
  readonly id: string;
  readonly scope: DocumentScope;
  readonly title: string;
  readonly sourceUri?: string;
  readonly objectKey: string;
  readonly checksum: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: DocumentStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
  readonly errorMessage?: string;
  readonly processingAttempts: number;
  readonly processingStartedAt?: Date;
  readonly processedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DocumentChunk {
  readonly id: string;
  readonly organizationId: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly content: string;
  readonly embedding?: MemoryEmbedding;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface NewDocument {
  readonly id: string;
  readonly scope: DocumentScope;
  readonly title: string;
  readonly sourceUri?: string;
  readonly objectKey: string;
  readonly checksum: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
  readonly now: Date;
}

export interface NewDocumentChunk {
  readonly id: string;
  readonly organizationId: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly content: string;
  readonly embedding?: MemoryEmbedding;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

export function createDocument(input: NewDocument): Document {
  const title = input.title.trim();
  const objectKey = input.objectKey.trim();
  const checksum = input.checksum.trim().toLowerCase();
  const mimeType = input.mimeType.trim().toLowerCase();
  if (title.length === 0) {
    throw new InvalidDocumentError("document title must not be empty");
  }
  if (objectKey.length === 0) {
    throw new InvalidDocumentError("document object key must not be empty");
  }
  if (!/^[0-9a-f]{64}$/.test(checksum)) {
    throw new InvalidDocumentError("document checksum must be SHA-256 hex");
  }
  if (mimeType.length === 0) {
    throw new InvalidDocumentError("document MIME type must not be empty");
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
    throw new InvalidDocumentError("document must contain at least one byte");
  }
  if (input.sourceUri !== undefined && input.sourceUri.trim().length === 0) {
    throw new InvalidDocumentError("document source URI must not be empty");
  }

  return Object.freeze({
    id: input.id,
    scope: Object.freeze({ ...input.scope }),
    title,
    ...(input.sourceUri ? { sourceUri: input.sourceUri.trim() } : {}),
    objectKey,
    checksum,
    mimeType,
    sizeBytes: input.sizeBytes,
    status: "pending",
    metadata: Object.freeze({ ...input.metadata }),
    createdBy: input.createdBy,
    processingAttempts: 0,
    createdAt: new Date(input.now),
    updatedAt: new Date(input.now)
  });
}

export function createDocumentChunk(input: NewDocumentChunk): DocumentChunk {
  const content = input.content.trim();
  if (content.length === 0) {
    throw new InvalidDocumentError("document chunk must not be empty");
  }
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
    throw new InvalidDocumentError("document chunk ordinal must be nonnegative");
  }
  if (
    input.embedding &&
    (input.embedding.model.trim().length === 0 ||
      input.embedding.values.length === 0 ||
      input.embedding.values.some((value) => !Number.isFinite(value)))
  ) {
    throw new InvalidDocumentError("document chunk embedding is invalid");
  }

  return Object.freeze({
    id: input.id,
    organizationId: input.organizationId,
    documentId: input.documentId,
    ordinal: input.ordinal,
    content,
    ...(input.embedding
      ? {
          embedding: Object.freeze({
            model: input.embedding.model.trim(),
            values: Object.freeze([...input.embedding.values])
          })
        }
      : {}),
    metadata: Object.freeze({ ...input.metadata }),
    createdAt: new Date(input.now)
  });
}
