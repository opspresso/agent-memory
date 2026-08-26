import type { OrganizationAccess } from "@/domain/identity/organization-access";

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

export interface DocumentRepository {
  save(document: Document): Promise<void>;
  findById(organizationId: string, documentId: string): Promise<Document | null>;
  claimForProcessing(
    organizationId: string,
    documentId: string,
    now: Date
  ): Promise<Document | null>;
  completeProcessing(
    document: Document,
    chunks: readonly DocumentChunk[],
    now: Date
  ): Promise<void>;
  failProcessing(
    organizationId: string,
    documentId: string,
    errorMessage: string,
    now: Date
  ): Promise<void>;
  search(input: DocumentSearchInput): Promise<readonly DocumentSearchHit[]>;
}
