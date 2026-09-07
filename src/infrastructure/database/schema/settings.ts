import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

import type { AppSettingName } from "@/domain/settings/app-settings";

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer().primaryKey().default(1),
    overrides: jsonb()
      .$type<Partial<Record<AppSettingName, string>>>()
      .notNull()
      .default({}),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [check("app_settings_singleton_check", sql`${table.id} = 1`)]
);
