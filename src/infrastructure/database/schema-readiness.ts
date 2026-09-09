import { sql } from "drizzle-orm";

import journal from "../../../drizzle/meta/_journal.json";
import { SafeOperationalError } from "../observability/safe-operational-error";
import type { AgentMemoryDatabase } from "./client";

export class DatabaseSchemaNotReadyError extends SafeOperationalError {
  constructor() {
    super(
      "Database migrations are pending. Run pnpm db:migrate against the application DATABASE_URL before starting the server.",
      { code: "DATABASE_SCHEMA_NOT_READY" }
    );
    this.name = "DatabaseSchemaNotReadyError";
  }
}

export async function checkSchemaReadiness(db: Pick<AgentMemoryDatabase, "execute">): Promise<void> {
  const table = await db.execute<{ present: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`
  );
  if (!table.rows[0]?.present) {
    throw new DatabaseSchemaNotReadyError();
  }
  const result = await db.execute<{ created_at: string }>(
    sql`select created_at from drizzle.__drizzle_migrations`
  );
  const applied = new Set(result.rows.map((row) => Number(row.created_at)));
  if (journal.entries.some((entry) => !applied.has(entry.when))) {
    throw new DatabaseSchemaNotReadyError();
  }
}
