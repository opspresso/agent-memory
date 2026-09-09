import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertSingleOrganizationBeforeMigration } from "@/infrastructure/database/repositories/installation-repository";

import { database } from "./database";
import { checkDatabaseReadiness } from "./health-service";

export async function prepareDatabase(shouldMigrate: boolean): Promise<void> {
  if (shouldMigrate) {
    await migrateOnStart();
  }
  await checkDatabaseReadiness();
}

export async function migrateOnStart(): Promise<void> {
  await assertSingleOrganizationBeforeMigration(database.db);
  await migrate(database.db, {
    migrationsFolder: path.join(process.cwd(), "drizzle")
  });
}
