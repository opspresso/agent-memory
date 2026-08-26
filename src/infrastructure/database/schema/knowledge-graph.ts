import { sql } from "drizzle-orm";
import {
  index,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { organizations } from "./identity";
import { documentChunks } from "./documents";
import { memories } from "./memories";
import { tsvector, unconstrainedVector } from "./custom-types";

export const knowledgeNodes = pgTable(
  "knowledge_nodes",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    canonicalName: text().notNull(),
    summary: text(),
    search: tsvector()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce(canonical_name, '') || ' ' || coalesce(summary, ''))`
      )
      .notNull(),
    embedding: unconstrainedVector(),
    embeddingModel: text(),
    properties: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    sourceMemoryId: uuid(),
    sourceChunkId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_nodes_identity_unique").on(
      table.organizationId,
      table.kind,
      table.canonicalName
    ),
    uniqueIndex("knowledge_nodes_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    foreignKey({
      columns: [table.organizationId, table.sourceMemoryId],
      foreignColumns: [memories.organizationId, memories.id],
      name: "knowledge_nodes_organization_memory_fk"
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceChunkId],
      foreignColumns: [documentChunks.organizationId, documentChunks.id],
      name: "knowledge_nodes_organization_chunk_fk"
    }).onDelete("restrict"),
    index("knowledge_nodes_search_idx").using("gin", table.search),
    index("knowledge_nodes_source_memory_idx").on(table.sourceMemoryId),
    index("knowledge_nodes_source_chunk_idx").on(table.sourceChunkId)
  ]
);

export const knowledgeEdges = pgTable(
  "knowledge_edges",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceNodeId: uuid().notNull(),
    targetNodeId: uuid().notNull(),
    predicate: text().notNull(),
    properties: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    sourceMemoryId: uuid(),
    sourceChunkId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("knowledge_edges_identity_unique").on(
      table.organizationId,
      table.sourceNodeId,
      table.predicate,
      table.targetNodeId
    ),
    foreignKey({
      columns: [table.organizationId, table.sourceNodeId],
      foreignColumns: [knowledgeNodes.organizationId, knowledgeNodes.id],
      name: "knowledge_edges_organization_source_node_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.targetNodeId],
      foreignColumns: [knowledgeNodes.organizationId, knowledgeNodes.id],
      name: "knowledge_edges_organization_target_node_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.sourceMemoryId],
      foreignColumns: [memories.organizationId, memories.id],
      name: "knowledge_edges_organization_memory_fk"
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.sourceChunkId],
      foreignColumns: [documentChunks.organizationId, documentChunks.id],
      name: "knowledge_edges_organization_chunk_fk"
    }).onDelete("restrict"),
    index("knowledge_edges_target_idx").on(
      table.organizationId,
      table.targetNodeId
    ),
    index("knowledge_edges_source_memory_idx").on(table.sourceMemoryId),
    index("knowledge_edges_source_chunk_idx").on(table.sourceChunkId)
  ]
);
