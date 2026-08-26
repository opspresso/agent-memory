import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
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
  DocumentRepository,
  DocumentSearchHit,
  DocumentSearchInput
} from "@/domain/document/document-repository";

import type { AgentMemoryDatabase } from "../client";
import { documentChunks, documents } from "../schema";

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
  const rawLexicalScore = sql<number>`ts_rank_cd(
    ${documentChunks.search},
    websearch_to_tsquery('simple', ${input.query})
  )`;
  const lexicalScore = sql<number>`${rawLexicalScore} / (1 + ${rawLexicalScore})`;
  if (!input.queryEmbedding) {
    return {
      lexicalScore,
      vectorScore: sql<number>`0::double precision`,
      score: lexicalScore,
      matches: sql`${documentChunks.search} @@ websearch_to_tsquery('simple', ${input.query})`
    };
  }

  const vectorLiteral = `[${input.queryEmbedding.values.join(",")}]`;
  const vectorScore = sql<number>`CASE
    WHEN ${documentChunks.embedding} IS NOT NULL
      AND ${documentChunks.embeddingModel} = ${input.queryEmbedding.model}
    THEN GREATEST(0, LEAST(1, 1 - ((${documentChunks.embedding} <=> ${vectorLiteral}::vector) / 2)))
    ELSE 0
  END`;
  return {
    lexicalScore,
    vectorScore,
    score: sql<number>`(0.4 * ${lexicalScore}) + (0.6 * ${vectorScore})`,
    matches: or(
      sql`${documentChunks.search} @@ websearch_to_tsquery('simple', ${input.query})`,
      and(
        isNotNull(documentChunks.embedding),
        eq(documentChunks.embeddingModel, input.queryEmbedding.model)
      )
    )
  };
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

    async claimForProcessing(organizationId, documentId, now) {
      const staleBefore = new Date(now.getTime() - 20 * 60 * 1_000);
      const [row] = await db
        .update(documents)
        .set({
          status: "processing",
          errorMessage: null,
          processingAttempts: sql`${documents.processingAttempts} + 1`,
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
      return row ? documentFromRow(row) : null;
    },

    async completeProcessing(document, chunks, now) {
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
            processedAt: now,
            updatedAt: now
          })
          .where(
            and(
              eq(documents.organizationId, document.scope.organizationId),
              eq(documents.id, document.id),
              eq(documents.status, "processing")
            )
          )
          .returning({ id: documents.id });
        if (!updated) {
          throw new Error("document processing claim was lost");
        }
      });
    },

    async failProcessing(organizationId, documentId, errorMessage, now) {
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
            eq(documents.id, documentId)
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
