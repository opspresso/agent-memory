import { PgBoss } from "pg-boss";

import {
  documentProcessingLeaseMilliseconds,
  type DocumentIngestionQueue,
  type DocumentKnowledgeEnrichmentQueue
} from "@/domain/document/document-services";

export const documentIngestionQueueName = "document-ingestion-v2";
export const documentKnowledgeEnrichmentQueueName =
  "document-knowledge-enrichment-v2";
const documentJobExpirationSeconds =
  documentProcessingLeaseMilliseconds / 1_000;

export interface DocumentIngestionJob {
  readonly expectedAttempts?: number;
  readonly organizationId: string;
  readonly documentId: string;
}

export interface DocumentKnowledgeEnrichmentJob {
  readonly organizationId: string;
  readonly chunkId: string;
}

export interface PgBossDocumentIngestionQueue
  extends DocumentIngestionQueue, DocumentKnowledgeEnrichmentQueue {
  start(): Promise<PgBoss>;
  stop(): Promise<void>;
}

export function createPgBossDocumentIngestionQueue(
  connectionString: string,
  onError: (error: Error) => void
): PgBossDocumentIngestionQueue {
  let started: Promise<PgBoss> | undefined;

  async function start() {
    started ??= (async () => {
      const boss = new PgBoss({
        application_name: "agent-memory",
        connectionString,
        schema: "pgboss"
      });
      boss.on("error", onError);
      await boss.start();
      try {
        await boss.createQueue(documentIngestionQueueName, {
          policy: "exclusive",
          retryLimit: 3,
          retryDelay: 5,
          retryBackoff: true,
          expireInSeconds: documentJobExpirationSeconds,
          deleteAfterSeconds: 604_800
        });
        await boss.createQueue(documentKnowledgeEnrichmentQueueName, {
          policy: "exclusive",
          retryLimit: 5,
          retryDelay: 15,
          retryBackoff: true,
          expireInSeconds: documentJobExpirationSeconds,
          deleteAfterSeconds: 604_800
        });
        return boss;
      } catch (error) {
        try {
          await boss.stop({ close: true, graceful: true, timeout: 30_000 });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "document queue startup and cleanup both failed"
          );
        }
        throw error;
      }
    })();
    try {
      return await started;
    } catch (error) {
      started = undefined;
      throw error;
    }
  }

  return {
    start,
    async enqueue(organizationId, documentId, expectedAttempts) {
      const instance = await start();
      const jobId = await instance.send(
        documentIngestionQueueName,
        { organizationId, documentId, ...(expectedAttempts !== undefined ? { expectedAttempts } : {}) } satisfies DocumentIngestionJob,
        // A stale job cannot claim a newer generation, so it must not suppress it.
        { singletonKey: expectedAttempts === undefined ? documentId : `${documentId}:${expectedAttempts}` }
      );
      return jobId ? "queued" : "already_queued";
    },
    async enqueueKnowledgeEnrichment(organizationId, chunkId) {
      const instance = await start();
      const jobId = await instance.send(
        documentKnowledgeEnrichmentQueueName,
        { organizationId, chunkId } satisfies DocumentKnowledgeEnrichmentJob,
        { singletonKey: chunkId }
      );
      return jobId ? "queued" : "already_queued";
    },
    async stop() {
      const running = started;
      started = undefined;
      if (running) {
        const boss = await running;
        await boss.stop({ close: true, graceful: true, timeout: 30_000 });
      }
    }
  };
}
