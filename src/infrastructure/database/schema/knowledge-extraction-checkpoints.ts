import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ProposedKnowledgeEntity } from "@/domain/knowledge/knowledge-candidate";
import { documentChunks } from "./documents";

export const knowledgeExtractionCheckpoints = pgTable("knowledge_extraction_checkpoints", {
  organizationId: uuid().notNull(),
  chunkId: uuid().notNull(),
  fingerprint: text().notNull(),
  model: text().notNull(),
  entities: jsonb().$type<readonly ProposedKnowledgeEntity[]>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.chunkId, table.fingerprint], name: "knowledge_extraction_checkpoints_pk" }),
  foreignKey({ columns: [table.organizationId, table.chunkId], foreignColumns: [documentChunks.organizationId, documentChunks.id],
    name: "knowledge_extraction_checkpoints_chunk_fk" }).onDelete("cascade"),
  check("knowledge_extraction_checkpoints_fingerprint_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check("knowledge_extraction_checkpoints_entities_check", sql`jsonb_typeof(${table.entities}) = 'array' AND jsonb_array_length(${table.entities}) <= 100`)
]);
