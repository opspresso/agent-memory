import { sql } from "drizzle-orm";
import { check, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { maxDocumentChunks } from "@/domain/document/document";
import type { DocumentTextPart } from "@/domain/document/document-processing-checkpoint";
import type { DocumentTextMimeType } from "@/domain/document/document-format";
import { documents } from "./documents";

export const documentProcessingCheckpoints = pgTable("document_processing_checkpoints", {
  organizationId: uuid().notNull(),
  documentId: uuid().notNull(),
  generation: uuid().notNull(),
  mimeType: text().$type<DocumentTextMimeType>().notNull(),
  parts: jsonb().$type<readonly DocumentTextPart[]>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.documentId, table.generation] }),
  foreignKey({ columns: [table.organizationId, table.documentId],
    foreignColumns: [documents.organizationId, documents.id], name: "document_processing_checkpoints_document_fk" }).onDelete("cascade"),
  check("document_processing_checkpoints_parts_check", sql`jsonb_typeof(${table.parts}) = 'array'
    AND jsonb_array_length(${table.parts}) BETWEEN 1 AND ${sql.raw(String(maxDocumentChunks))}`)
]);
