import { PgBoss, type JobWithMetadata } from "pg-boss";
import type { KnowledgeExtractionPrincipal } from "@/domain/knowledge/knowledge-extraction-service";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

import {
  documentProcessingLeaseMilliseconds,
  type DocumentIngestionQueue,
  type DocumentKnowledgeEnrichmentQueue
} from "@/domain/document/document-services";

export const documentIngestionQueueName = "document-ingestion-v3";
export const documentKnowledgeEnrichmentQueueName =
  "document-knowledge-enrichment-v3";
const documentJobExpirationSeconds =
  documentProcessingLeaseMilliseconds / 1_000;

export interface DocumentIngestionJob {
  readonly generation: string;
  readonly requestedBy: string;
  readonly principalKind?: OrganizationAccess["principalKind"];
  readonly organizationId: string;
  readonly documentId: string;
}

export interface DocumentKnowledgeEnrichmentJob {
  readonly organizationId: string;
  readonly chunkId: string;
  readonly principal: KnowledgeExtractionPrincipal;
}

export interface PgBossDocumentIngestionQueue
  extends DocumentIngestionQueue, DocumentKnowledgeEnrichmentQueue {
  start(): Promise<PgBoss>;
  stop(): Promise<void>;
  deferIngestion(claim: Pick<JobWithMetadata, "id" | "retryCount" | "startedOn">, retryAfterSeconds: number): Promise<"deferred" | "lost_claim">;
  deferKnowledgeEnrichment(claim: Pick<JobWithMetadata, "id" | "retryCount" | "startedOn">, retryAfterSeconds: number): Promise<"deferred" | "lost_claim">;
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
      try {
        await boss.start();
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

  async function deferJob(queueName: typeof documentIngestionQueueName | typeof documentKnowledgeEnrichmentQueueName,
    claim: Pick<JobWithMetadata, "id" | "retryCount" | "startedOn">, retryAfterSeconds: number): Promise<"deferred" | "lost_claim"> {
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1) throw new Error("invalid document job deferral delay");
    const instance = await start();
    const database = instance.getDb();
    if (!database.beginTransaction) throw new Error("document job deferral requires transactional queue storage");
    const transaction = await database.beginTransaction();
    try {
      await transaction.db.executeSql("SET LOCAL statement_timeout = '5s'");
      // pg-boss completion has no expected-attempt argument. Fence and lock the
      // original claim so a late worker cannot complete a newer retry of this ID.
      // The driver exposes timestamps as Date, which retains only milliseconds.
      const locked = await transaction.db.executeSql(
        "SELECT id FROM pgboss.job WHERE name=$1 AND id=$2 AND state='active' AND retry_count=$3 AND date_trunc('milliseconds', started_on)=$4 FOR UPDATE",
        [queueName, claim.id, claim.retryCount, claim.startedOn]
      );
      if (!locked.rows.length) {
        await transaction.rollback();
        return "lost_claim";
      }
      const current = await instance.getJobById<DocumentIngestionJob | DocumentKnowledgeEnrichmentJob>(queueName, claim.id, { db: transaction.db });
      if (!current) throw new Error("document queue claim disappeared");
      if (!current.singletonKey) throw new Error("document job deferral requires an exclusive identity");
      await instance.complete(queueName, claim.id, { deferred: true }, { db: transaction.db });
      const replacement = await instance.send(queueName, current.data, {
        db: transaction.db, singletonKey: current.singletonKey,
        priority: current.priority, startAfter: retryAfterSeconds,
        // Quota waits neither spend nor replenish retries for actual failures.
        retryLimit: Math.max(0, current.retryLimit - current.retryCount),
        retryDelay: current.retryBackoff ? current.retryDelay * 2 ** current.retryCount : current.retryDelay,
        retryBackoff: current.retryBackoff,
        ...(current.retryDelayMax !== undefined ? { retryDelayMax: current.retryDelayMax } : {}),
        expireInSeconds: current.expireInSeconds, deleteAfterSeconds: current.deleteAfterSeconds
      });
      if (!replacement) throw new Error("document job deferral did not create a continuation");
      await transaction.commit();
      return "deferred";
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  return {
    start,
    async enqueue(organizationId, documentId, generation, requestedBy, principalKind) {
      const instance = await start();
      const jobId = await instance.send(
        documentIngestionQueueName,
        { organizationId, documentId, generation, requestedBy, principalKind } satisfies DocumentIngestionJob,
        // A stale job cannot claim a newer generation, so it must not suppress it.
        { singletonKey: `${documentId}:${generation}` }
      );
      return jobId ? "queued" : "already_queued";
    },
    async enqueueKnowledgeEnrichment(organizationId, chunkId, principal, priority = principal.action === "manage" ? 10 : 0) {
      const instance = await start();
      const jobId = await instance.send(
        documentKnowledgeEnrichmentQueueName,
        { organizationId, chunkId, principal } satisfies DocumentKnowledgeEnrichmentJob,
        { singletonKey: chunkId, priority }
      );
      if (!jobId && principal.action === "manage") {
        await instance.update({
          name: documentKnowledgeEnrichmentQueueName,
          data: { organizationId, chunkId, principal },
          options: { singletonKey: chunkId, priority }
        });
      }
      return jobId ? "queued" : "already_queued";
    },
    deferIngestion: (claim, seconds) => deferJob(documentIngestionQueueName, claim, seconds),
    deferKnowledgeEnrichment: (claim, seconds) => deferJob(documentKnowledgeEnrichmentQueueName, claim, seconds),
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
