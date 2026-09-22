import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import { users } from "./identity";

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("auth_sessions_token_unique").on(table.token),
    index("auth_sessions_user_id_idx").on(table.userId)
  ]
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("auth_accounts_user_id_idx").on(table.userId),
    uniqueIndex("auth_accounts_provider_id_account_id_unique").on(
      table.providerId,
      table.accountId
    )
  ]
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)]
);
