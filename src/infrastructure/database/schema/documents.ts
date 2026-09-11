import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { organizationMembers, organizations, teams, users } from "./identity";
import { memoryScopeKind } from "./memories";
import { tsvector, unconstrainedVector } from "./custom-types";
import { documentStatuses } from "@/domain/document/document";
import type { ScopedResource } from "@/domain/identity/organization-access";
import type { KnowledgeScopeChangeSummary } from "@/domain/document/document-scope-change";

export const documentStatus = pgEnum("document_status", [...documentStatuses]);

export const documents = pgTable(
  "documents",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeKind: memoryScopeKind().notNull(),
    teamId: uuid(),
    userId: uuid(),
    title: text().notNull(),
    sourceUri: text(),
    objectKey: text().notNull(),
    checksum: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull().default(0),
    status: documentStatus().notNull().default("pending"),
    errorMessage: text(),
    processingAttempts: integer().notNull().default(0),
    processingLeaseId: uuid(),
    processingStartedAt: timestamp({ withTimezone: true }),
    processedAt: timestamp({ withTimezone: true }),
    metadata: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "documents_scope_owner_check",
      sql`(${table.scopeKind} = 'organization' AND ${table.teamId} IS NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'user' AND ${table.teamId} IS NULL AND ${table.userId} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: "documents_organization_team_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "documents_organization_user_fk"
    }).onDelete("cascade"),
    uniqueIndex("documents_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    index("documents_organization_checksum_idx").on(
      table.organizationId,
      table.checksum
    ),
    check("documents_nonnegative_size_check", sql`${table.sizeBytes} >= 0`),
    check(
      "documents_nonnegative_attempts_check",
      sql`${table.processingAttempts} >= 0`
    ),
    index("documents_scope_idx").on(
      table.organizationId,
      table.scopeKind,
      table.teamId,
      table.userId
    )
  ]
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    documentId: uuid().notNull(),
    ordinal: integer().notNull(),
    content: text().notNull(),
    search: tsvector()
      .generatedAlwaysAs(sql`to_tsvector('simple', coalesce(content, ''))`)
      .notNull(),
    embedding: unconstrainedVector(),
    embeddingModel: text(),
    metadata: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check("document_chunks_nonnegative_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "document_chunks_embedding_pair_check",
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.documentId],
      foreignColumns: [documents.organizationId, documents.id],
      name: "document_chunks_organization_document_fk"
    }).onDelete("cascade"),
    uniqueIndex("document_chunks_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    uniqueIndex("document_chunks_organization_document_id_unique").on(
      table.organizationId,
      table.documentId,
      table.id
    ),
    uniqueIndex("document_chunks_document_ordinal_unique").on(
      table.documentId,
      table.ordinal
    ),
    index("document_chunks_search_idx").using("gin", table.search)
  ]
);

export const documentScopeChanges = pgTable("document_scope_changes", {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  organizationId: uuid().notNull().references(() => organizations.id, { onDelete: "cascade" }),
  documentId: uuid().notNull(),
  previousScope: jsonb().$type<ScopedResource>().notNull(),
  scope: jsonb().$type<ScopedResource>().notNull(),
  knowledge: jsonb().$type<KnowledgeScopeChangeSummary>().notNull(),
  changedBy: uuid().notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
}, (table) => [
  foreignKey({ columns: [table.organizationId, table.documentId], foreignColumns: [documents.organizationId, documents.id], name: "document_scope_changes_document_fk" }).onDelete("cascade"),
  index("document_scope_changes_document_idx").on(table.organizationId, table.documentId, table.createdAt)
]);
