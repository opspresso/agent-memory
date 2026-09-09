import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { database } from "./database";
import { checkDatabaseReadiness } from "./health-service";

export async function prepareDatabase(): Promise<void> {
  await initializeSchema(database.pool);
  await checkDatabaseReadiness();
}
