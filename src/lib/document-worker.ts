import { randomUUID } from "node:crypto";

import { z } from "zod";

import { buildProcessDocument } from "@/application/document/process-document";
import { buildIngestDocument } from "@/application/document/ingest-document";
import { buildGenerateKnowledgeCandidate } from "@/application/knowledge/generate-knowledge-candidate";
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

const ingestionJobSchema = z.object({
  expectedAttempts: z.number().int().min(0).optional(),
  organizationId: z.uuid(),
  documentId: z.uuid()
});

const enrichmentJobSchema = z.object({
  organizationId: z.uuid(),
  chunkId: z.uuid()
});

const processDocument = buildProcessDocument({
  clock: () => new Date(),
  generateId: randomUUID,
  objectStorage: documentObjectStorage,
  repository: documentRepository,
  textExtractor: documentTextExtractor,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

const generateKnowledgeCandidate = knowledgeExtractionService
  ? buildGenerateKnowledgeCandidate({
      candidateRepository: knowledgeCandidateRepository,
      clock: () => new Date(),
      documentRepository,
      extractionService: knowledgeExtractionService,
      generateId: randomUUID,
      ontologyReader: knowledgeOntologyReader
    })
  : undefined;

const ingestDocument = buildIngestDocument({
  processDocument,
  repository: documentRepository,
  ...(generateKnowledgeCandidate ? { enrichmentQueue: documentIngestionQueue } : {})
});

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
          const data = ingestionJobSchema.parse(job.data);
          logger.info(
            { documentId: data.documentId, organizationId: data.organizationId },
            "processing document ingestion job"
          );
          try {
            if (data.expectedAttempts === undefined) await ingestDocument(data.organizationId, data.documentId);
            else await ingestDocument(data.organizationId, data.documentId, data.expectedAttempts);
          } catch (error) {
            logger.error(
              {
                err: error,
                documentId: data.documentId,
                organizationId: data.organizationId
              },
              "document ingestion job failed"
            );
            throw error;
          }
        }
      }
    );
    const enrichmentWorker = generateKnowledgeCandidate
      ? boss.work<DocumentKnowledgeEnrichmentJob>(
          documentKnowledgeEnrichmentQueueName,
          {
            batchSize: 1,
            localConcurrency: 1,
            pollingIntervalSeconds: 2
          },
          async (jobs) => {
            for (const job of jobs) {
              const data = enrichmentJobSchema.parse(job.data);
              logger.info(
                {
                  chunkId: data.chunkId,
                  organizationId: data.organizationId
                },
                "generating document knowledge candidates"
              );
              try {
                await generateKnowledgeCandidate(
                  data.organizationId,
                  data.chunkId
                );
              } catch (error) {
                logger.error(
                  {
                    err: error,
                    chunkId: data.chunkId,
                    organizationId: data.organizationId
                  },
                  "document knowledge enrichment job failed"
                );
                throw error;
              }
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
