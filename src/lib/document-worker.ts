import { randomUUID } from "node:crypto";

import { z } from "zod";

import { buildProcessDocument } from "@/application/document/process-document";
import { buildGenerateDocumentKnowledgeCandidates } from "@/application/knowledge/generate-knowledge-candidate";
import { logger } from "@/infrastructure/observability/logger";
import {
  documentIngestionQueueName,
  documentKnowledgeEnrichmentQueueName,
  type DocumentKnowledgeEnrichmentJob,
  type DocumentIngestionJob
} from "@/infrastructure/queue/document-ingestion-queue";

import {
  documentIngestionQueue,
  knowledgeCandidateRepository,
  knowledgeExtractionService,
  knowledgeOntologyReader,
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

const generateDocumentKnowledgeCandidates = knowledgeExtractionService
  ? buildGenerateDocumentKnowledgeCandidates({
      candidateRepository: knowledgeCandidateRepository,
      clock: () => new Date(),
      documentRepository,
      extractionService: knowledgeExtractionService,
      generateId: randomUUID,
      ontologyReader: knowledgeOntologyReader
    })
  : undefined;

let workers: Promise<readonly string[]> | undefined;

export async function startDocumentWorker(): Promise<void> {
  workers ??= (async () => {
    const boss = await documentIngestionQueue.start();
    const ingestionWorker = boss.work<DocumentIngestionJob>(
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
          if (generateDocumentKnowledgeCandidates) {
            const document = await documentRepository.findById(
              data.organizationId,
              data.documentId
            );
            if (document?.status === "ready") {
              await documentIngestionQueue.enqueueKnowledgeEnrichment(
                data.organizationId,
                data.documentId
              );
            }
          }
        }
      }
    );
    const enrichmentWorker = generateDocumentKnowledgeCandidates
      ? boss.work<DocumentKnowledgeEnrichmentJob>(
          documentKnowledgeEnrichmentQueueName,
          {
            batchSize: 1,
            localConcurrency: 1,
            pollingIntervalSeconds: 2
          },
          async (jobs) => {
            for (const job of jobs) {
              const data = jobSchema.parse(job.data);
              logger.info(
                {
                  documentId: data.documentId,
                  organizationId: data.organizationId
                },
                "generating document knowledge candidates"
              );
              await generateDocumentKnowledgeCandidates(
                data.organizationId,
                data.documentId
              );
            }
          }
        )
      : undefined;
    const registered = await Promise.all(
      enrichmentWorker
        ? [ingestionWorker, enrichmentWorker]
        : [ingestionWorker]
    );
    logger.info("document ingestion worker started");
    return registered;
  })().catch(async (error: unknown) => {
    workers = undefined;
    try {
      await documentIngestionQueue.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "document worker startup and queue cleanup both failed"
      );
    }
    throw error;
  });

  await workers;
}
