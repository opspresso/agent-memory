import { PgBoss } from "pg-boss";

import type { DocumentIngestionQueue } from "@/domain/document/document-services";

export const documentIngestionQueueName = "document-ingestion";
export const documentKnowledgeEnrichmentQueueName =
  "document-knowledge-enrichment";

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
  ): Promise<void>;
  start(): Promise<PgBoss>;
  stop(): Promise<void>;
}

export function createPgBossDocumentIngestionQueue(
  connectionString: string,
  onError: (error: Error) => void
): PgBossDocumentIngestionQueue {
  const boss = new PgBoss({
    application_name: "agent-memory",
    connectionString,
    schema: "pgboss"
  });
  boss.on("error", onError);
  let started: Promise<PgBoss> | undefined;

  async function start() {
    started ??= (async () => {
      await boss.start();
      await boss.createQueue(documentIngestionQueueName, {
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 900,
        deleteAfterSeconds: 604_800
      });
      await boss.createQueue(documentKnowledgeEnrichmentQueueName, {
        retryLimit: 5,
        retryDelay: 15,
        retryBackoff: true,
        expireInSeconds: 900,
        deleteAfterSeconds: 604_800
      });
      return boss;
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
      await instance.send(
        documentIngestionQueueName,
        { organizationId, documentId } satisfies DocumentIngestionJob,
        { singletonKey: documentId, singletonSeconds: 60 }
      );
    },
    async enqueueKnowledgeEnrichment(organizationId, documentId) {
      const instance = await start();
      await instance.send(
        documentKnowledgeEnrichmentQueueName,
        { organizationId, documentId } satisfies DocumentKnowledgeEnrichmentJob,
        { singletonKey: documentId, singletonSeconds: 60 }
      );
    },
    async stop() {
      if (started) {
        await boss.stop({ close: true, graceful: true, timeout: 30_000 });
        started = undefined;
      }
    }
  };
}
