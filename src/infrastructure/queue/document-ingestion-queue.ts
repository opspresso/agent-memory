import { PgBoss } from "pg-boss";

import {
  documentProcessingLeaseMilliseconds,
  type DocumentQueueEnqueueResult,
  type DocumentIngestionQueue
} from "@/domain/document/document-services";

export const documentIngestionQueueName = "document-ingestion";
export const documentKnowledgeEnrichmentQueueName =
  "document-knowledge-enrichment";
const documentJobExpirationSeconds =
  documentProcessingLeaseMilliseconds / 1_000;

export interface DocumentIngestionJob {
  readonly organizationId: string;
  readonly documentId: string;
}

export type DocumentKnowledgeEnrichmentJob = DocumentIngestionJob;

export interface PgBossDocumentIngestionQueue
  extends DocumentIngestionQueue {
  enqueueKnowledgeEnrichment(
    organizationId: string,
    documentId: string
  ): Promise<DocumentQueueEnqueueResult>;
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
    async enqueue(organizationId, documentId) {
      const instance = await start();
      const jobId = await instance.send(
        documentIngestionQueueName,
        { organizationId, documentId } satisfies DocumentIngestionJob,
        { singletonKey: documentId }
      );
      return jobId ? "queued" : "already_queued";
    },
    async enqueueKnowledgeEnrichment(organizationId, documentId) {
      const instance = await start();
      const jobId = await instance.send(
        documentKnowledgeEnrichmentQueueName,
        { organizationId, documentId } satisfies DocumentKnowledgeEnrichmentJob,
        { singletonKey: documentId }
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
