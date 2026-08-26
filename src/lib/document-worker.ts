import { randomUUID } from "node:crypto";

import { z } from "zod";

import { buildProcessDocument } from "@/application/document/process-document";
import { logger } from "@/infrastructure/observability/logger";
import {
  documentIngestionQueueName,
  type DocumentIngestionJob
} from "@/infrastructure/queue/document-ingestion-queue";

import {
  documentIngestionQueue,
  documentObjectStorage,
  documentRepository,
  documentTextExtractor,
  textEmbeddingService
} from "./container";

const jobSchema = z.object({
  organizationId: z.uuid(),
  documentId: z.uuid()
});

const processDocument = buildProcessDocument({
  clock: () => new Date(),
  generateId: randomUUID,
  objectStorage: documentObjectStorage,
  repository: documentRepository,
  textExtractor: documentTextExtractor,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

let worker: Promise<string> | undefined;

export async function startDocumentWorker(): Promise<void> {
  if (worker) {
    await worker;
    return;
  }

  const boss = await documentIngestionQueue.start();
  worker = boss.work<DocumentIngestionJob>(
    documentIngestionQueueName,
    {
      batchSize: 1,
      localConcurrency: 2,
      pollingIntervalSeconds: 2
    },
    async (jobs) => {
      for (const job of jobs) {
        const data = jobSchema.parse(job.data);
        logger.info(
          { documentId: data.documentId, organizationId: data.organizationId },
          "processing document ingestion job"
        );
        await processDocument(data.organizationId, data.documentId);
      }
    }
  );
  await worker;
  logger.info("document ingestion worker started");
}
