import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  ForeignKeyBuilder,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgTableExtraConfigValue
} from "drizzle-orm/pg-core";

import {
  organizationMemberStatuses,
  organizationRoles,
  teamRoles,
  type NewMemberStatus
} from "@/domain/identity/organization-access";
import {
  defaultKnowledgeOntology,
  defaultKnowledgeOntologyMode,
  knowledgeOntologyModes,
  type KnowledgeOntology,
  type KnowledgeOntologyMode
} from "@/domain/knowledge/knowledge-ontology";

export const organizationRole = pgEnum("organization_role", [...organizationRoles]);

export const organizationMemberStatus = pgEnum("organization_member_status", [
  ...organizationMemberStatuses
]);

export const teamRole = pgEnum("team_role", [...teamRoles]);

export const knowledgeOntologyMode = pgEnum("knowledge_ontology_mode", [
  ...knowledgeOntologyModes
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    slug: text().notNull(),
    name: text().notNull(),
    newMemberStatus: organizationMemberStatus()
      .$type<NewMemberStatus>()
      .notNull()
      .default("pending"),
    defaultTeamId: uuid(),
    ontologyMode: knowledgeOntologyMode()
      .$type<KnowledgeOntologyMode>()
      .notNull()
      .default(defaultKnowledgeOntologyMode),
    ontology: jsonb()
      .$type<KnowledgeOntology>()
      .notNull()
      .default(defaultKnowledgeOntology),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("organizations_slug_unique").on(table.slug),
    check(
      "organizations_new_member_status_check",
      sql`${table.newMemberStatus} IN ('active', 'pending')`
    ),
    new ForeignKeyBuilder(() => ({
      columns: [table.id, table.defaultTeamId],
      foreignColumns: [
        teams.organizationId as AnyPgColumn,
        teams.id as AnyPgColumn
      ],
      name: "organizations_default_team_fk"
    }))
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    name: text().notNull(),
    image: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid()
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRole().notNull().default("member"),
    status: organizationMemberStatus().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("organization_members_user_idx").on(table.userId)
  ]
);

export const organizationAgentTokens = pgTable(
  "organization_agent_tokens",
  {
    organizationId: uuid()
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid().notNull(),
    tokenHash: text().notNull(),
    encryptedToken: text("token"),
    masked: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "organization_agent_tokens_member_fk"
    }).onDelete("cascade"),
    uniqueIndex("organization_agent_tokens_hash_unique").on(table.tokenHash)
  ]
);

export const teams = pgTable(
  "teams",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    name: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("teams_organization_slug_unique").on(
      table.organizationId,
      table.slug
    ),
    uniqueIndex("teams_organization_id_id_unique").on(
      table.organizationId,
      table.id
    )
  ]
);

export const teamMembers = pgTable(
  "team_members",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid().notNull(),
    userId: uuid().notNull(),
    role: teamRole().notNull().default("member"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    foreignKey({
      columns: [table.organizationId, table.teamId],
      foreignColumns: [teams.organizationId, teams.id],
      name: "team_members_organization_team_fk"
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [
        organizationMembers.organizationId,
        organizationMembers.userId
      ],
      name: "team_members_organization_user_fk"
    }).onDelete("cascade"),
    index("team_members_user_idx").on(table.organizationId, table.userId)
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  teams: many(teams)
}));

export const usersRelations = relations(users, ({ many }) => ({
  organizations: many(organizationMembers),
  teams: many(teamMembers)
}));

export const teamsRelations = relations(teams, ({ many, one }) => ({
  organization: one(organizations, {
    fields: [teams.organizationId],
    references: [organizations.id]
  }),
  members: many(teamMembers)
}));
