import { buildGetDocumentChunk } from "@/application/document/get-document-chunk";
import { buildListDocuments } from "@/application/document/list-documents";
import { createHash, randomUUID } from "node:crypto";

import { buildArchiveDocument } from "@/application/document/archive-document";
import { buildGetDocument } from "@/application/document/get-document";
import { buildRetryDocument } from "@/application/document/retry-document";
import { buildSearchDocuments } from "@/application/document/search-documents";
import { buildUploadDocument } from "@/application/document/upload-document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import { observeRetrieval } from "@/infrastructure/observability/telemetry";

import {
  documentIngestionQueue,
  documentObjectStorage,
  documentRepository,
  textEmbeddingService
} from "./container";
import { readDocumentUploadLimits } from "./document-upload-limits";

export const uploadDocumentRecord = buildUploadDocument({
  checksum: (content) => createHash("sha256").update(content).digest("hex"),
  clock: () => new Date(),
  generateId: randomUUID,
  limits: readDocumentUploadLimits(),
  objectStorage: documentObjectStorage,
  queue: documentIngestionQueue,
  repository: documentRepository
});

export const getDocumentRecord = buildGetDocument(documentRepository);

export const archiveDocumentRecord = buildArchiveDocument({
  clock: () => new Date(),
  repository: documentRepository
});

const searchDocumentRecordsBase = buildSearchDocuments({
  repository: documentRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export async function searchDocumentRecords(
  access: OrganizationAccess,
  query: string,
  limit = 10,
  queryEmbedding?: MemoryEmbedding
) {
  return observeRetrieval("document.search", access, limit, () =>
    searchDocumentRecordsBase(access, query, limit, queryEmbedding)
  );
}

export const retryDocumentRecord = buildRetryDocument({
  queue: documentIngestionQueue,
  repository: documentRepository
});

export const listDocumentRecords = buildListDocuments(documentRepository);

export const getDocumentChunkRecord = buildGetDocumentChunk(documentRepository);
