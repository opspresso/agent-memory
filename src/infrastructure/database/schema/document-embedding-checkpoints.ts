import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import { maxDocumentEmbeddingBatchSize } from "@/domain/document/document-embedding-checkpoint";
import { documents } from "./documents";

export const documentEmbeddingCheckpoints = pgTable("document_embedding_checkpoints", {
  organizationId: uuid().notNull(),
  documentId: uuid().notNull(),
  generation: uuid().notNull(),
  fingerprint: text().notNull(),
  embeddings: jsonb().$type<readonly MemoryEmbedding[]>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.documentId, table.generation, table.fingerprint] }),
  foreignKey({ columns: [table.organizationId, table.documentId],
    foreignColumns: [documents.organizationId, documents.id], name: "document_embedding_checkpoints_document_fk" }).onDelete("cascade"),
  check("document_embedding_checkpoints_fingerprint_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check("document_embedding_checkpoints_batch_check", sql`jsonb_typeof(${table.embeddings}) = 'array'
    AND jsonb_array_length(${table.embeddings}) BETWEEN 1 AND ${sql.raw(String(maxDocumentEmbeddingBatchSize))}`)
]);
