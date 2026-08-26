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
  DocumentSearchHit,
  DocumentSearchInput
} from "@/domain/document/document-repository";

import type { AgentMemoryDatabase } from "../client";
import { documentChunks, documents } from "../schema";
import { hybridSearchExpressions } from "./hybrid-search";

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
  if (access.role === "admin" || access.role === "owner") {
    return sql`true`;
  }
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(documents.scopeKind, "organization"),
    and(
      eq(documents.scopeKind, "user"),
      eq(documents.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(documents.scopeKind, "team"),
          inArray(documents.teamId, teamIds)
        )
      : undefined
  );
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
): DocumentRepository {
  return {
    async save(document) {
      await db.insert(documents).values({
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
      });
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

    async claimForProcessing(organizationId, documentId, now) {
      const staleBefore = new Date(now.getTime() - 20 * 60 * 1_000);
      const [row] = await db
        .update(documents)
        .set({
          status: "processing",
          errorMessage: null,
          processingAttempts: sql`${documents.processingAttempts} + 1`,
          processingLeaseId: sql`uuidv7()`,
          processingStartedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(documents.organizationId, organizationId),
            eq(documents.id, documentId),
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
