import { sql } from "drizzle-orm";

import { database } from "./container";

export async function checkDatabaseReadiness(): Promise<void> {
  await database.db.execute(sql`select 1`);
}
