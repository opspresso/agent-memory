import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  or,
  sql
} from "drizzle-orm";

import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type {
  Document,
  DocumentChunk,
  DocumentScope
} from "@/domain/document/document";
import type {
  DocumentChunkRecord,
  DocumentProcessingClaim,
  DocumentRepository,
  DocumentLibraryReader,
  DocumentChunkPageReader,
  DocumentSearchHit,
  DocumentSearchInput,
  DocumentUploadLimits,
  SaveDocumentResult
} from "@/domain/document/document-repository";
import { documentProcessingLeaseMilliseconds } from "@/domain/document/document-services";

import type { AgentMemoryDatabase } from "../client";
import { assertIngestionResource, type IngestionReceipt } from "@/domain/shared/ingestion-receipt";
import { insertIngestionReceipt, refuseIngestionReplay } from "./ingestion-receipt-repository";
import { documentChunks, documents } from "../schema";
import { hybridSearchExpressions } from "./hybrid-search";
import { scopedReadPredicate } from "./scope-predicates";

type DocumentRow = typeof documents.$inferSelect;
type ChunkRow = typeof documentChunks.$inferSelect;

function scopeFromRow(row: DocumentRow): DocumentScope {
  if (row.scopeKind === "team" && row.teamId) {
    return {
      kind: "team",
      organizationId: row.organizationId,
      teamId: row.teamId
    };
  }
  if (row.scopeKind === "user" && row.userId) {
    return {
      kind: "user",
      organizationId: row.organizationId,
      userId: row.userId
    };
  }
  return { kind: "organization", organizationId: row.organizationId };
}

function documentFromRow(row: DocumentRow): Document {
  return {
    id: row.id,
    scope: scopeFromRow(row),
    title: row.title,
    ...(row.sourceUri ? { sourceUri: row.sourceUri } : {}),
    objectKey: row.objectKey,
    checksum: row.checksum,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    metadata: row.metadata,
    createdBy: row.createdBy,
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
    processingAttempts: row.processingAttempts,
    ...(row.processingStartedAt
      ? { processingStartedAt: row.processingStartedAt }
      : {}),
    ...(row.processedAt ? { processedAt: row.processedAt } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function chunkFromRow(row: ChunkRow): DocumentChunk {
  return {
    id: row.id,
    organizationId: row.organizationId,
    documentId: row.documentId,
    ordinal: row.ordinal,
    content: row.content,
    ...(row.embedding && row.embeddingModel
      ? { embedding: { model: row.embeddingModel, values: row.embedding } }
      : {}),
    metadata: row.metadata,
    createdAt: row.createdAt
  };
}

function accessPredicate(access: OrganizationAccess) {
  return scopedReadPredicate(access, documents);
}

function scoreExpressions(input: DocumentSearchInput) {
  return hybridSearchExpressions({
    search: documentChunks.search,
    embedding: documentChunks.embedding,
    embeddingModel: documentChunks.embeddingModel,
    query: input.query,
    ...(input.queryEmbedding ? { queryEmbedding: input.queryEmbedding } : {})
  });
}

export function createDocumentRepository(
  db: AgentMemoryDatabase
): DocumentRepository & DocumentLibraryReader & DocumentChunkPageReader {
  function documentValues(document: Document) {
    return {
      id: document.id,
      organizationId: document.scope.organizationId,
      scopeKind: document.scope.kind,
      teamId: document.scope.kind === "team" ? document.scope.teamId : null,
      userId: document.scope.kind === "user" ? document.scope.userId : null,
      title: document.title,
      sourceUri: document.sourceUri ?? null,
      objectKey: document.objectKey,
      checksum: document.checksum,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      metadata: document.metadata,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    };
  }

  async function saveWithinLimits(
    document: Document,
    limits: DocumentUploadLimits,
    receipt?: IngestionReceipt
  ): Promise<SaveDocumentResult> {
    return db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${document.scope.organizationId}, 0))`
      );
      if (receipt) await refuseIngestionReplay(transaction, receipt);
      const oneHourBefore = new Date(document.createdAt.getTime() - 3_600_000);
      const [usage] = await transaction
        .select({
          storageBytes: sql<string>`coalesce(sum(${documents.sizeBytes}), 0)`,
          pendingDocuments: sql<number>`count(*) filter (
            where ${documents.status} in ('pending', 'processing')
          )::int`,
          recentUserUploads: sql<number>`count(*) filter (
            where ${documents.createdBy} = ${document.createdBy}
              and ${documents.createdAt} >= ${oneHourBefore}
          )::int`
        })
        .from(documents)
        .where(eq(documents.organizationId, document.scope.organizationId));
      const storageBytes = Number(usage?.storageBytes ?? 0);
      if (
        storageBytes + document.sizeBytes >
        limits.maximumOrganizationStorageBytes
      ) {
        return "organization_storage_exceeded";
      }
      if (
        (usage?.pendingDocuments ?? 0) >= limits.maximumPendingDocuments
      ) {
        return "pending_documents_exceeded";
      }
      if (
        (usage?.recentUserUploads ?? 0) >= limits.maximumUserUploadsPerHour
      ) {
        return "user_rate_exceeded";
      }
      if (receipt) await insertIngestionReceipt(transaction, receipt);
      await transaction.insert(documents).values(documentValues(document));
      return "saved";
    });
  }

  return {
    async save(document, limits, receipt) {
      if (receipt) assertIngestionResource(receipt, "document.upload", document.scope.organizationId, document.createdBy, document.id);
      if (limits) {
        return saveWithinLimits(document, limits, receipt);
      }
      if (receipt) {
        return db.transaction(async (transaction) => {
          await insertIngestionReceipt(transaction, receipt);
          await transaction.insert(documents).values(documentValues(document));
          return "saved" as const;
        });
      }
      await db.insert(documents).values(documentValues(document));
      return "saved";
    },

    async findById(organizationId, documentId) {
      const [row] = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.id, documentId)
          )
        )
        .limit(1);
      return row ? documentFromRow(row) : null;
    },

    async prepareRetry(document, expectedAttempts, receipt) {
      if (receipt.operation !== "document.retry" || receipt.organizationId !== document.scope.organizationId || receipt.resourceId !== document.id) {
        throw new Error("retry receipt does not match its document");
      }
      return db.transaction(async (transaction) => {
        await refuseIngestionReplay(transaction, receipt);
        const [current] = await transaction.select().from(documents).where(and(
          eq(documents.organizationId, document.scope.organizationId), eq(documents.id, document.id)
        )).for("update").limit(1);
        if (!current || current.status !== "failed" || current.processingAttempts !== expectedAttempts) return null;
        await insertIngestionReceipt(transaction, receipt);
        const [updated] = await transaction.update(documents).set({ status: "pending", errorMessage: null,
          processingStartedAt: null, processingLeaseId: null, updatedAt: receipt.createdAt }).where(and(
          eq(documents.organizationId, document.scope.organizationId), eq(documents.id, document.id)
        )).returning();
        return updated ? documentFromRow(updated) : null;
      });
    },

    async findChunkById(organizationId, chunkId) {
      const [row] = await db
        .select({
          document: getTableColumns(documents),
          chunk: getTableColumns(documentChunks)
        })
        .from(documentChunks)
        .innerJoin(
          documents,
          and(
            eq(documents.organizationId, documentChunks.organizationId),
            eq(documents.id, documentChunks.documentId)
          )
        )
        .where(
          and(
            eq(documentChunks.organizationId, organizationId),
            eq(documentChunks.id, chunkId)
          )
        )
        .limit(1);
      return row
        ? ({
            document: documentFromRow(row.document),
            chunk: chunkFromRow(row.chunk)
          } satisfies DocumentChunkRecord)
        : null;
    },

    async readChunks(input) {
      return db.transaction(async (tx) => {
        const [document] = await tx.select().from(documents).where(and(
          eq(documents.organizationId, input.access.organizationId),
          eq(documents.id, input.documentId),
          eq(documents.status, "ready"),
          accessPredicate(input.access)
        )).limit(1);
        if (!document) return null;
        const chunks = await tx.select().from(documentChunks).where(and(
          eq(documentChunks.organizationId, input.access.organizationId),
          eq(documentChunks.documentId, input.documentId)
        )).orderBy(documentChunks.ordinal, documentChunks.id).limit(input.limit).offset(input.offset);
        return { document: documentFromRow(document), chunks: chunks.map(chunkFromRow) };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },

    async listChunksByDocument(organizationId, documentId) {
      const rows = await db
        .select({ chunk: getTableColumns(documentChunks) })
        .from(documentChunks)
        .innerJoin(
          documents,
          and(
            eq(documents.organizationId, documentChunks.organizationId),
            eq(documents.id, documentChunks.documentId)
          )
        )
        .where(
          and(
            eq(documentChunks.organizationId, organizationId),
            eq(documentChunks.documentId, documentId),
            eq(documents.status, "ready")
          )
        )
        .orderBy(documentChunks.ordinal);
      return rows.map((row) => chunkFromRow(row.chunk));
    },

    async claimForProcessing(organizationId, documentId, now, expectedAttempts) {
      const staleBefore = new Date(
        now.getTime() - documentProcessingLeaseMilliseconds
      );
      const [row] = await db
        .update(documents)
        .set({
          status: "processing",
          errorMessage: null,
          processingAttempts: expectedAttempts === undefined ? sql`${documents.processingAttempts} + 1`
            : sql`case when ${documents.status} = 'processing' then ${documents.processingAttempts} else ${documents.processingAttempts} + 1 end`,
          processingLeaseId: sql`uuidv7()`,
          processingStartedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.id, documentId),
            expectedAttempts === undefined ? undefined : or(
              and(inArray(documents.status, ["pending", "failed"]), eq(documents.processingAttempts, expectedAttempts)),
              and(eq(documents.status, "processing"), eq(documents.processingAttempts, expectedAttempts + 1))
            ),
            or(
              inArray(documents.status, ["pending", "failed"]),
              and(
                eq(documents.status, "processing"),
                or(
                  isNull(documents.processingStartedAt),
                  lt(documents.processingStartedAt, staleBefore)
                )
              )
            )
          )
        )
        .returning();
      return row?.processingLeaseId
        ? ({
            document: documentFromRow(row),
            leaseId: row.processingLeaseId
          } satisfies DocumentProcessingClaim)
        : null;
    },

    async completeProcessing(claim, chunks, now) {
      const { document, leaseId } = claim;
      await db.transaction(async (transaction) => {
        await transaction
          .delete(documentChunks)
          .where(
            and(
              eq(documentChunks.organizationId, document.scope.organizationId),
              eq(documentChunks.documentId, document.id)
            )
          );
        if (chunks.length > 0) {
          await transaction.insert(documentChunks).values(
            chunks.map((chunk) => ({
              organizationId: chunk.organizationId,
              id: chunk.id,
              documentId: chunk.documentId,
              ordinal: chunk.ordinal,
              content: chunk.content,
              embedding: chunk.embedding?.values ?? null,
              embeddingModel: chunk.embedding?.model ?? null,
              metadata: chunk.metadata,
              createdAt: chunk.createdAt
            }))
          );
        }
        const [updated] = await transaction
          .update(documents)
          .set({
            status: "ready",
            errorMessage: null,
            processingLeaseId: null,
            processedAt: now,
            updatedAt: now
          })
          .where(
            and(
              eq(documents.organizationId, document.scope.organizationId),
              eq(documents.id, document.id),
              eq(documents.status, "processing"),
              eq(documents.processingLeaseId, leaseId)
            )
          )
          .returning({ id: documents.id });
        if (!updated) {
          throw new Error("document processing claim was lost");
        }
      });
    },

    async failProcessing(claim, errorMessage, now) {
      const [updated] = await db
        .update(documents)
        .set({
          status: "failed",
          errorMessage: errorMessage.slice(0, 2_000),
          processingLeaseId: null,
          updatedAt: now
        })
        .where(
          and(
            eq(documents.organizationId, claim.document.scope.organizationId),
            eq(documents.id, claim.document.id),
            eq(documents.status, "processing"),
            eq(documents.processingLeaseId, claim.leaseId)
          )
        )
        .returning({ id: documents.id });
      return updated !== undefined;
    },

    async markEnqueueFailure(organizationId, documentId, errorMessage, now) {
      await db
        .update(documents)
        .set({
          status: "failed",
          errorMessage: errorMessage.slice(0, 2_000),
          updatedAt: now
        })
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.id, documentId),
            eq(documents.status, "pending")
          )
        );
    },

    async archive(organizationId, documentId, now) {
      const [archived] = await db
        .update(documents)
        .set({
          status: "archived",
          errorMessage: null,
          processingLeaseId: null,
          updatedAt: now
        })
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.id, documentId),
            sql`${documents.status} <> 'archived'`
          )
        )
        .returning({ id: documents.id });
      return archived !== undefined;
    },

    async list(input) {
      const rows = await db.select().from(documents).where(and(
        eq(documents.organizationId, input.access.organizationId),
        sql`${documents.status} <> 'archived'`,
        accessPredicate(input.access)
      )).orderBy(desc(documents.createdAt), desc(documents.id))
        .limit(input.limit).offset(input.offset);
      return rows.map(documentFromRow);
    },

    async search(input) {
      const scores = scoreExpressions(input);
      const rows = await db
        .select({
          document: getTableColumns(documents),
          chunk: getTableColumns(documentChunks),
          lexicalScore: scores.lexicalScore,
          vectorScore: scores.vectorScore,
          score: scores.score
        })
        .from(documentChunks)
        .innerJoin(
          documents,
          and(
            eq(documents.organizationId, documentChunks.organizationId),
            eq(documents.id, documentChunks.documentId)
          )
        )
        .where(
          and(
            eq(documents.organizationId, input.access.organizationId),
            eq(documents.status, "ready"),
            accessPredicate(input.access),
            scores.matches
          )
        )
        .orderBy(desc(scores.score), documentChunks.ordinal)
        .limit(input.limit);

      return rows.map(
        (row): DocumentSearchHit => ({
          document: documentFromRow(row.document),
          chunk: chunkFromRow(row.chunk),
          lexicalScore: row.lexicalScore,
          vectorScore: row.vectorScore,
          score: row.score
        })
      );
    }
  };
}
