import path from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { database } from "./database";

export async function migrateOnStart(): Promise<void> {
  await migrate(database.db, {
    migrationsFolder: path.join(process.cwd(), "drizzle")
  });
}
