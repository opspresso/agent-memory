import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import {
  knowledgeCandidateStatuses,
  type KnowledgeCandidateItemReview,
  type ProposedKnowledgeGraph
} from "@/domain/knowledge/knowledge-candidate";

import { documentChunks, documents } from "./documents";
import { organizations, users } from "./identity";
import { knowledgeEdges, knowledgeNodes } from "./knowledge-graph";

export const knowledgeCandidateStatus = pgEnum(
  "knowledge_candidate_status",
  [...knowledgeCandidateStatuses]
);

export const knowledgeCandidates = pgTable(
  "knowledge_candidates",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid().notNull(),
    chunkId: uuid().notNull(),
    model: text().notNull(),
    graph: jsonb().$type<ProposedKnowledgeGraph>().notNull(),
    itemReviews: jsonb().$type<readonly KnowledgeCandidateItemReview[]>().notNull().default([]),
    status: knowledgeCandidateStatus().notNull().default("pending"),
    reviewedBy: uuid().references(() => users.id, { onDelete: "restrict" }),
    reviewReason: text(),
    reviewedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.documentId],
      foreignColumns: [documents.organizationId, documents.id],
      name: "knowledge_candidates_organization_document_fk"
    }).onDelete("cascade"),
    check(
      "knowledge_candidates_review_state_check",
      sql`(${table.status} = 'pending' AND ${table.reviewedBy} IS NULL AND ${table.reviewedAt} IS NULL)
        OR (${table.status} IN ('accepted', 'rejected') AND ${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.documentId, table.chunkId],
      foreignColumns: [
        documentChunks.organizationId,
        documentChunks.documentId,
        documentChunks.id
      ],
      name: "knowledge_candidates_document_chunk_fk"
    }).onDelete("cascade"),
    uniqueIndex("knowledge_candidates_organization_chunk_unique").on(
      table.organizationId,
      table.chunkId
    ),
    unique("knowledge_candidates_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    index("knowledge_candidates_review_queue_idx").on(
      table.organizationId,
      table.status,
      table.createdAt
    )
  ]
);

export const knowledgeCandidateNodes = pgTable(
  "knowledge_candidate_nodes",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: uuid().notNull(),
    nodeId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.candidateId, table.nodeId],
      name: "knowledge_candidate_nodes_pk"
    }),
    foreignKey({
      columns: [table.organizationId, table.candidateId],
      foreignColumns: [
        knowledgeCandidates.organizationId,
        knowledgeCandidates.id
      ],
      name: "knowledge_candidate_nodes_organization_candidate_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.nodeId],
      foreignColumns: [knowledgeNodes.organizationId, knowledgeNodes.id],
      name: "knowledge_candidate_nodes_organization_node_fk"
    }).onDelete("cascade"),
    index("knowledge_candidate_nodes_node_idx").on(
      table.organizationId,
      table.nodeId
    )
  ]
);

export const knowledgeCandidateEdges = pgTable(
  "knowledge_candidate_edges",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    candidateId: uuid().notNull(),
    edgeId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.candidateId, table.edgeId],
      name: "knowledge_candidate_edges_pk"
    }),
    foreignKey({
      columns: [table.organizationId, table.candidateId],
      foreignColumns: [
        knowledgeCandidates.organizationId,
        knowledgeCandidates.id
      ],
      name: "knowledge_candidate_edges_organization_candidate_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.edgeId],
      foreignColumns: [knowledgeEdges.organizationId, knowledgeEdges.id],
      name: "knowledge_candidate_edges_organization_edge_fk"
    }).onDelete("cascade"),
    index("knowledge_candidate_edges_edge_idx").on(
      table.organizationId,
      table.edgeId
    )
  ]
);
