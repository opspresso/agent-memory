import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertSingleOrganizationBeforeMigration } from "@/infrastructure/database/repositories/installation-repository";

import { database } from "./database";

export async function migrateOnStart(): Promise<void> {
  await assertSingleOrganizationBeforeMigration(database.db);
  await migrate(database.db, {
    migrationsFolder: path.join(process.cwd(), "drizzle")
  });
}
