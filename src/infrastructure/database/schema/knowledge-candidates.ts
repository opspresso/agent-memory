import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import {
  knowledgeCandidateStatuses,
  type ProposedKnowledgeGraph
} from "@/domain/knowledge/knowledge-candidate";

import { documentChunks, documents } from "./documents";
import { organizationMembers, organizations } from "./identity";

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
    status: knowledgeCandidateStatus().notNull().default("pending"),
    reviewedBy: uuid(),
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
    foreignKey({
      columns: [table.organizationId, table.reviewedBy],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "knowledge_candidates_organization_reviewer_fk"
    }).onDelete("restrict"),
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
    index("knowledge_candidates_review_queue_idx").on(
      table.organizationId,
      table.status,
      table.createdAt
    )
  ]
);
