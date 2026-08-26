import { createHash, randomUUID } from "node:crypto";

import { buildGetDocument } from "@/application/document/get-document";
import { buildRetryDocument } from "@/application/document/retry-document";
import { buildSearchDocuments } from "@/application/document/search-documents";
import { buildUploadDocument } from "@/application/document/upload-document";

import {
  documentIngestionQueue,
  documentObjectStorage,
  documentRepository,
  textEmbeddingService
} from "./container";

export const uploadDocumentRecord = buildUploadDocument({
  checksum: (content) => createHash("sha256").update(content).digest("hex"),
  clock: () => new Date(),
  generateId: randomUUID,
  objectStorage: documentObjectStorage,
  queue: documentIngestionQueue,
  repository: documentRepository
});

export const getDocumentRecord = buildGetDocument(documentRepository);

export const searchDocumentRecords = buildSearchDocuments({
  repository: documentRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const retryDocumentRecord = buildRetryDocument({
  queue: documentIngestionQueue,
  repository: documentRepository
});
