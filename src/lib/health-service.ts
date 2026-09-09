import { sql } from "drizzle-orm";
import { checkSchemaReadiness } from "@/infrastructure/database/schema-readiness";

import { database } from "./database";

export { DatabaseSchemaNotReadyError } from "@/infrastructure/database/schema-readiness";

export async function checkDatabaseReadiness(): Promise<void> {
  await database.db.execute(sql`select 1`);
  await checkSchemaReadiness(database.db);
}
