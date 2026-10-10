import { randomUUID } from "node:crypto";
import { curateKnowledgeCandidate } from "./knowledge-curation-service";
import { readKnowledgeEnrichmentConcurrency } from "./document-worker-configuration";

import { z } from "zod";
import type { WorkOptions } from "pg-boss";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";

import { buildProcessDocument } from "@/application/document/process-document";
import { buildIngestDocument } from "@/application/document/ingest-document";
import { buildGenerateKnowledgeCandidate } from "@/application/knowledge/generate-knowledge-candidate";
import { logger } from "@/infrastructure/observability/logger";
import { safeErrorForBoundary } from "@/infrastructure/observability/error-details";
import {
  documentIngestionQueueName,
  documentKnowledgeEnrichmentQueueName,
  type DocumentKnowledgeEnrichmentJob,
  type DocumentIngestionJob
} from "@/infrastructure/queue/document-ingestion-queue";

import {
  documentIngestionQueue,
  organizationAccessRepository,
  knowledgeCandidateRepository,
  knowledgeExtractionService,
  knowledgeOntologyReader,
  documentObjectStorage,
  documentRepository,
  documentTextExtractor,
  documentProcessingCheckpointRepository,
  documentEmbeddingCheckpoints,
  textEmbeddingService
} from "./container";

const ingestionJobSchema = z.object({
  generation: z.uuid(),
  requestedBy: z.uuid(),
  principalKind: z.enum(["user", "organization-agent"]).optional(),
  organizationId: z.uuid(),
  documentId: z.uuid()
});

const enrichmentJobSchema = z.object({
  organizationId: z.uuid(),
  chunkId: z.uuid(),
  principal: z.object({ userId: z.uuid(), action: z.enum(["write", "manage"]), principalKind: z.enum(["user", "organization-agent"]).optional() })
});

const processDocument = buildProcessDocument({
  accessRepository: organizationAccessRepository,
  clock: () => new Date(),
  generateId: randomUUID,
  objectStorage: documentObjectStorage,
  repository: documentRepository,
  textExtractor: documentTextExtractor,
  processingCheckpoints: documentProcessingCheckpointRepository,
  ...(documentEmbeddingCheckpoints ? { embeddingCheckpoints: documentEmbeddingCheckpoints } : {}),
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

const generateKnowledgeCandidate = knowledgeExtractionService
  ? buildGenerateKnowledgeCandidate({
      accessRepository: organizationAccessRepository,
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

function failJob(error: unknown, identifiers: { readonly organizationId: string; readonly documentId?: string; readonly chunkId?: string }, message: string): never {
  logger.error({ err: error, ...identifiers }, message);
  throw safeErrorForBoundary(error, message);
}

export async function startDocumentWorker(): Promise<void> {
  workers ??= (async () => {
    const boss = await documentIngestionQueue.start();
    const ingestionWorker = boss.work<DocumentIngestionJob, unknown, WorkOptions & { includeMetadata: true }>(
      documentIngestionQueueName,
      {
        batchSize: 1,
        localConcurrency: 2,
        pollingIntervalSeconds: 2,
        includeMetadata: true
      },
      async (jobs) => {
        for (const job of jobs) {
          const data = ingestionJobSchema.parse(job.data);
          logger.info(
            { documentId: data.documentId, organizationId: data.organizationId },
            "processing document ingestion job"
          );
          try {
            await ingestDocument(data.organizationId, data.documentId, data.generation, data.requestedBy, data.principalKind);
          } catch (error) {
            if (error instanceof AiRequestLimitExceededError) {
              try {
                const outcome = await documentIngestionQueue.deferIngestion(job, error.retryAfterSeconds);
                logger.info({ organizationId: data.organizationId, documentId: data.documentId, retryAfterSeconds: error.retryAfterSeconds, outcome }, "document ingestion deferred");
              } catch (deferralError) {
                failJob(deferralError, { documentId: data.documentId, organizationId: data.organizationId }, "document ingestion deferral failed");
              }
              continue;
            }
            failJob(error, { documentId: data.documentId, organizationId: data.organizationId }, "document ingestion job failed");
          }
        }
      }
    );
    const enrichmentWorker = generateKnowledgeCandidate
      ? boss.work<DocumentKnowledgeEnrichmentJob, unknown, WorkOptions & { includeMetadata: true }>(
          documentKnowledgeEnrichmentQueueName,
          {
            batchSize: 1,
            localConcurrency: readKnowledgeEnrichmentConcurrency(),
            pollingIntervalSeconds: 2,
            includeMetadata: true
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
                  data.chunkId,
                  data.principal
                );
                await curateKnowledgeCandidate?.(data.organizationId, data.chunkId, data.principal.userId, data.principal.principalKind);
              } catch (error) {
                if (error instanceof AiRequestLimitExceededError) {
                  try {
                    const outcome = await documentIngestionQueue.deferKnowledgeEnrichment(job, error.retryAfterSeconds);
                    logger.info({ organizationId: data.organizationId, chunkId: data.chunkId, retryAfterSeconds: error.retryAfterSeconds, outcome }, "document knowledge enrichment deferred");
                  } catch (deferralError) {
                    failJob(deferralError, { organizationId: data.organizationId, chunkId: data.chunkId }, "document knowledge deferral failed");
                  }
                  continue;
                }
                failJob(error, { chunkId: data.chunkId, organizationId: data.organizationId }, "document knowledge enrichment job failed");
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
