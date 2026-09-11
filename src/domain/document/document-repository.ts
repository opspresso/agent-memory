import type { OrganizationAccess, ScopedResource } from "@/domain/identity/organization-access";
import type { IngestionReceipt } from "@/domain/shared/ingestion-receipt";

import type { Document, DocumentChunk } from "./document";

export interface DocumentSearchInput {
  readonly access: OrganizationAccess;
  readonly query: string;
  readonly queryEmbedding?: Readonly<{
    model: string;
    values: readonly number[];
  }>;
  readonly limit: number;
}

export interface DocumentSearchHit {
  readonly document: Document;
  readonly chunk: DocumentChunk;
  readonly lexicalScore: number;
  readonly vectorScore: number;
  readonly score: number;
}

export interface DocumentChunkRecord {
  readonly document: Document;
  readonly chunk: DocumentChunk;
}

export interface DocumentProcessingClaim {
  readonly document: Document;
  readonly leaseId: string;
}

export interface DocumentUploadLimits {
  readonly maximumOrganizationStorageBytes: number;
  readonly maximumPendingDocuments: number;
  readonly maximumUserUploadsPerHour: number;
}

export type SaveDocumentResult =
  | "saved"
  | "organization_storage_exceeded"
  | "pending_documents_exceeded"
  | "user_rate_exceeded";

export interface DocumentRepository {
  save(
    document: Document,
    limits?: DocumentUploadLimits,
    receipt?: IngestionReceipt
  ): Promise<SaveDocumentResult>;
  findById(organizationId: string, documentId: string): Promise<Document | null>;
  prepareRetry?(document: Document, expectedAttempts: number, receipt: IngestionReceipt): Promise<Document | null>;
  findChunkById(
    organizationId: string,
    chunkId: string
  ): Promise<DocumentChunkRecord | null>;
  listChunksByDocument(
    organizationId: string,
    documentId: string
  ): Promise<readonly DocumentChunk[]>;
  claimForProcessing(
    organizationId: string,
    documentId: string,
    now: Date,
    expectedAttempts?: number
  ): Promise<DocumentProcessingClaim | null>;
  completeProcessing(
    claim: DocumentProcessingClaim,
    chunks: readonly DocumentChunk[],
    now: Date
  ): Promise<void>;
  failProcessing(
    claim: DocumentProcessingClaim,
    errorMessage: string,
    now: Date
  ): Promise<boolean>;
  markEnqueueFailure(
    organizationId: string,
    documentId: string,
    errorMessage: string,
    now: Date
  ): Promise<void>;
  archive(
    organizationId: string,
    documentId: string,
    now: Date,
    expectedScope: ScopedResource
  ): Promise<boolean>;
  search(input: DocumentSearchInput): Promise<readonly DocumentSearchHit[]>;
}

export interface DocumentLibraryReader {
  list(input: {
    readonly access: OrganizationAccess;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly Document[]>;
}

export interface DocumentChunkPageReader {
  readChunks(input: {
    readonly access: OrganizationAccess;
    readonly documentId: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<{ readonly document: Document; readonly chunks: readonly DocumentChunk[] } | null>;
}
