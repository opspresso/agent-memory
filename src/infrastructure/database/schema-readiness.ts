import { sql } from "drizzle-orm";

import { readSchemaArtifact } from "./schema-bootstrap.mjs";
import { SafeOperationalError } from "../observability/safe-operational-error";
import type { AgentMemoryDatabase } from "./client";

export class DatabaseSchemaNotReadyError extends SafeOperationalError {
  constructor() {
    super(
      "Database schema does not match this application. Initialize an empty database with pnpm db:init or explicitly reset the installation.",
      { code: "DATABASE_SCHEMA_NOT_READY" }
    );
    this.name = "DatabaseSchemaNotReadyError";
  }
}

export async function checkSchemaReadiness(db: Pick<AgentMemoryDatabase, "execute">): Promise<void> {
  const table = await db.execute<{ present: boolean }>(
    sql`select to_regclass('public.application_schema') is not null as present`
  );
  if (!table.rows[0]?.present) {
    throw new DatabaseSchemaNotReadyError();
  }
  const result = await db.execute<{ fingerprint: string }>(
    sql`select fingerprint from public.application_schema where id = 1`
  );
  if (result.rows[0]?.fingerprint !== readSchemaArtifact().hash) {
    throw new DatabaseSchemaNotReadyError();
  }
}
