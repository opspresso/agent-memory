import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import {
  memoryKinds,
  memoryPermissions,
  memoryStatuses,
  memorySourceTypes,
  type MemoryAccessGrant
} from "@/domain/memory/memory";

import {
  organizationMembers,
  organizations,
  teams
} from "./identity";
import { tsvector, unconstrainedVector } from "./custom-types";

export const memoryKind = pgEnum("memory_kind", [...memoryKinds]);
export const memoryScopeKind = pgEnum("memory_scope_kind", [
  "organization",
  "team",
  "user"
]);
export const memorySourceType = pgEnum("memory_source_type", [
  ...memorySourceTypes
]);
export const memoryStatus = pgEnum("memory_status", [...memoryStatuses]);
export const memoryPermission = pgEnum("memory_permission", [
  ...memoryPermissions
]);
export const memoryPrincipalKind = pgEnum("memory_principal_kind", [
  "team",
  "user"
]);

export const memories = pgTable(
  "memories",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scopeKind: memoryScopeKind().notNull(),
    teamId: uuid(),
    userId: uuid(),
    kind: memoryKind().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    search: tsvector()
      .generatedAlwaysAs(
        sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))`
      )
      .notNull(),
    sourceType: memorySourceType().notNull(),
    sourceUri: text(),
    sourceAgentId: text(),
    sourceMetadata: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    embedding: unconstrainedVector(),
    embeddingModel: text(),
    createdBy: uuid().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }),
    status: memoryStatus().notNull().default("active"),
    currentVersion: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "memories_scope_owner_check",
      sql`(${table.scopeKind} = 'organization' AND ${table.teamId} IS NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.userId} IS NULL)
        OR (${table.scopeKind} = 'user' AND ${table.teamId} IS NULL AND ${table.userId} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: "memories_organization_team_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "memories_organization_user_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.createdBy],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "memories_organization_creator_fk"
    }).onDelete("restrict"),
    uniqueIndex("memories_organization_id_id_unique").on(
      table.organizationId,
      table.id
    ),
    check(
      "memories_expiry_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.validFrom}`
    ),
    check(
      "memories_embedding_pair_check",
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)`
    ),
    index("memories_scope_idx").on(
      table.organizationId,
      table.scopeKind,
      table.teamId,
      table.userId
    ),
    index("memories_search_idx").using("gin", table.search),
    index("memories_validity_idx").on(
      table.organizationId,
      table.status,
      table.validFrom,
      table.expiresAt
    )
  ]
);

export const memoryVersions = pgTable(
  "memory_versions",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    memoryId: uuid().notNull(),
    version: integer().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    sourceType: memorySourceType().notNull(),
    sourceUri: text(),
    sourceAgentId: text(),
    sourceMetadata: jsonb().$type<Readonly<Record<string, unknown>>>().notNull().default({}),
    embedding: unconstrainedVector(),
    embeddingModel: text(),
    accessGrants: jsonb()
      .$type<readonly MemoryAccessGrant[]>()
      .notNull()
      .default([]),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    status: memoryStatus().notNull(),
    changedBy: uuid().notNull(),
    changeReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.version] }),
    foreignKey({
      columns: [table.organizationId, table.memoryId],
      foreignColumns: [memories.organizationId, memories.id],
      name: "memory_versions_organization_memory_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.changedBy],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "memory_versions_organization_changer_fk"
    }).onDelete("restrict"),
    check("memory_versions_positive_version_check", sql`${table.version} > 0`),
    check(
      "memory_versions_expiry_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.validFrom}`
    ),
    check(
      "memory_versions_embedding_pair_check",
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)`
    )
  ]
);

export const memoryAccessGrants = pgTable(
  "memory_access_grants",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    memoryId: uuid().notNull(),
    principalKind: memoryPrincipalKind().notNull(),
    teamId: uuid(),
    userId: uuid(),
    permission: memoryPermission().notNull(),
    grantedBy: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check(
      "memory_access_grants_principal_check",
      sql`(${table.principalKind} = 'team' AND ${table.teamId} IS NOT NULL AND ${table.userId} IS NULL)
        OR (${table.principalKind} = 'user' AND ${table.teamId} IS NULL AND ${table.userId} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.memoryId],
      foreignColumns: [memories.organizationId, memories.id],
      name: "memory_access_grants_organization_memory_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: "memory_access_grants_organization_team_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "memory_access_grants_organization_user_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.grantedBy],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "memory_access_grants_organization_granter_fk"
    }).onDelete("restrict"),
    uniqueIndex("memory_access_grants_team_unique")
      .on(table.memoryId, table.teamId)
      .where(sql`${table.teamId} IS NOT NULL`),
    uniqueIndex("memory_access_grants_user_unique")
      .on(table.memoryId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`)
  ]
);
