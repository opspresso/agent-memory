import { sql } from "drizzle-orm";
import {
  check,
  index,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { organizationMembers, organizations, teams, users } from "./identity";
import { documentChunks } from "./documents";
import { memories, memoryScopeKind } from "./memories";
import { tsvector, unconstrainedVector } from "./custom-types";

export const knowledgeNodes = pgTable(
  "knowledge_nodes",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeKind: memoryScopeKind().notNull().default("organization"),
    teamId: uuid(),
    userId: uuid(),
    kind: text().notNull(),
    canonicalName: text().notNull(),
    canonicalNameKey: text()
      .generatedAlwaysAs(
        sql`lower(regexp_replace(trim(canonical_name), '[[:space:]]+', ' ', 'g'))`
      ),
    summary: text(),
    search: tsvector()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce(canonical_name, '') || ' ' || coalesce(summary, ''))`
      )
      .notNull(),
    embedding: unconstrainedVector(),
    embeddingModel: text(),
    properties: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "knowledge_nodes_scope_owner_check",
      sql`(${table.scopeKind} = 'organization' AND ${table.teamId} IS NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'user' AND ${table.teamId} IS NULL AND ${table.userId} IS NOT NULL)`
    ),
    check(
      "knowledge_nodes_embedding_pair_check",
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: "knowledge_nodes_organization_team_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "knowledge_nodes_organization_user_fk"
    }).onDelete("cascade"),
    unique("knowledge_nodes_identity_unique").on(
      table.organizationId,
      table.scopeKind,
      table.teamId,
      table.userId,
      table.kind,
      table.canonicalName
    ).nullsNotDistinct(),
    uniqueIndex("knowledge_nodes_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    index("knowledge_nodes_normalized_identity_idx").on(
      table.organizationId,
      table.scopeKind,
      table.teamId,
      table.userId,
      table.kind,
      table.canonicalNameKey
    ),
    index("knowledge_nodes_search_idx").using("gin", table.search)
  ]
);

export const knowledgeEdges = pgTable(
  "knowledge_edges",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeKind: memoryScopeKind().notNull().default("organization"),
    teamId: uuid(),
    userId: uuid(),
    sourceNodeId: uuid().notNull(),
    targetNodeId: uuid().notNull(),
    predicate: text().notNull(),
    properties: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "knowledge_edges_scope_owner_check",
      sql`(${table.scopeKind} = 'organization' AND ${table.teamId} IS NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'user' AND ${table.teamId} IS NULL AND ${table.userId} IS NOT NULL)`
    ),
    check(
      "knowledge_edges_non_self_check",
      sql`${table.sourceNodeId} <> ${table.targetNodeId}`
    ),
    foreignKey({
      columns: [table.organizationId, table.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: "knowledge_edges_organization_team_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "knowledge_edges_organization_user_fk"
    }).onDelete("cascade"),
    unique("knowledge_edges_identity_unique").on(
      table.organizationId,
      table.scopeKind,
      table.teamId,
      table.userId,
      table.sourceNodeId,
      table.predicate,
      table.targetNodeId
    ).nullsNotDistinct(),
    uniqueIndex("knowledge_edges_organization_id_id_unique").on(
      table.organizationId,
      table.id
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
    index("knowledge_edges_target_idx").on(
      table.organizationId,
      table.targetNodeId
    )
  ]
);

export const knowledgeNodeSources = pgTable(
  "knowledge_node_sources",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    nodeId: uuid().notNull(),
    memoryId: uuid(),
    chunkId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "knowledge_node_sources_exactly_one_source_check",
      sql`(${table.memoryId} IS NOT NULL) <> (${table.chunkId} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.nodeId],
      foreignColumns: [knowledgeNodes.organizationId, knowledgeNodes.id],
      name: "knowledge_node_sources_organization_node_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.memoryId],
      foreignColumns: [memories.organizationId, memories.id],
      name: "knowledge_node_sources_organization_memory_fk"
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.chunkId],
      foreignColumns: [documentChunks.organizationId, documentChunks.id],
      name: "knowledge_node_sources_organization_chunk_fk"
    }).onDelete("restrict"),
    unique("knowledge_node_sources_identity_unique")
      .on(table.organizationId, table.nodeId, table.memoryId, table.chunkId)
      .nullsNotDistinct(),
    index("knowledge_node_sources_node_idx").on(
      table.organizationId,
      table.nodeId
    ),
    index("knowledge_node_sources_memory_idx").on(table.memoryId),
    index("knowledge_node_sources_chunk_idx").on(table.chunkId)
  ]
);

export const knowledgeEdgeSources = pgTable(
  "knowledge_edge_sources",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    edgeId: uuid().notNull(),
    memoryId: uuid(),
    chunkId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "knowledge_edge_sources_exactly_one_source_check",
      sql`(${table.memoryId} IS NOT NULL) <> (${table.chunkId} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.edgeId],
      foreignColumns: [knowledgeEdges.organizationId, knowledgeEdges.id],
      name: "knowledge_edge_sources_organization_edge_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.memoryId],
      foreignColumns: [memories.organizationId, memories.id],
      name: "knowledge_edge_sources_organization_memory_fk"
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.organizationId, table.chunkId],
      foreignColumns: [documentChunks.organizationId, documentChunks.id],
      name: "knowledge_edge_sources_organization_chunk_fk"
    }).onDelete("restrict"),
    unique("knowledge_edge_sources_identity_unique")
      .on(table.organizationId, table.edgeId, table.memoryId, table.chunkId)
      .nullsNotDistinct(),
    index("knowledge_edge_sources_edge_idx").on(
      table.organizationId,
      table.edgeId
    ),
    index("knowledge_edge_sources_memory_idx").on(table.memoryId),
    index("knowledge_edge_sources_chunk_idx").on(table.chunkId)
  ]
);

export const knowledgeNodeMerges = pgTable(
  "knowledge_node_merges",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceNodeId: uuid().notNull(),
    targetNodeId: uuid().notNull(),
    sourceKind: text().notNull(),
    sourceCanonicalName: text().notNull(),
    mergedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("knowledge_node_merges_source_idx").on(
      table.organizationId,
      table.sourceNodeId
    ),
    index("knowledge_node_merges_target_idx").on(
      table.organizationId,
      table.targetNodeId
    )
  ]
);
