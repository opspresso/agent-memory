import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    idleTimeoutMillis: 30_000,
    max: 10
  });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  return { db, pool };
}

export type AgentMemoryDatabase = ReturnType<typeof createDatabase>["db"];
