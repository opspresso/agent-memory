import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";

import { organizations } from "./identity";

export const aiRequestBuckets = pgTable(
  "ai_request_buckets",
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    principalKey: text().notNull(),
    windowStartedAt: timestamp({ withTimezone: true }).notNull(),
    requestCount: integer().notNull()
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.principalKey,
        table.windowStartedAt
      ]
    }),
    check("ai_request_buckets_positive_count_check", sql`${table.requestCount} > 0`),
    index("ai_request_buckets_window_idx").on(table.windowStartedAt)
  ]
);
