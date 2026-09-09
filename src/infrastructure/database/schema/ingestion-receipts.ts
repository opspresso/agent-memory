import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizationMembers } from "./identity";

export const ingestionReceipts = pgTable("ingestion_receipts", {
  organizationId: uuid().notNull(),
  userId: uuid().notNull(),
  operation: text().notNull(),
  key: text().notNull(),
  payloadHash: text().notNull(),
  resourceId: uuid().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull()
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.userId, table.operation, table.key] }),
  foreignKey({ columns: [table.organizationId, table.userId],
    foreignColumns: [organizationMembers.organizationId, organizationMembers.userId],
    name: "ingestion_receipts_member_fk" }).onDelete("cascade"),
  check("ingestion_receipts_key_length", sql`length(${table.key}) between 1 and 256`),
  check("ingestion_receipts_hash_shape", sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`),
  check("ingestion_receipts_operation", sql`${table.operation} in ('memory.create', 'document.upload', 'document.retry')`)
]);
