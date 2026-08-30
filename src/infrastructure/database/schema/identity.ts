import { relations, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn
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
    defaultTeamId: uuid().references((): AnyPgColumn => teams.id, {
      onDelete: "set null"
    }),
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
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)]
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
      .references(() => organizations.id, { onDelete: "cascade" }),
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
