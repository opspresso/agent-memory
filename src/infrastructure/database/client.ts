import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10
  });
  const connectionClosures = new Set<Promise<void>>();
  pool.on("connect", (client) => {
    const closed = new Promise<void>((resolve) => {
      client.once("end", () => {
        connectionClosures.delete(closed);
        resolve();
      });
    });
    connectionClosures.add(closed);
  });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      await pool.end();
      // pg-pool removes clients before their sockets emit end. Wait for the
      // physical connections before stopping dependencies or exiting runtime.
      await Promise.all(connectionClosures);
    })();
    return closing;
  }
  const db = drizzle(pool, { schema, casing: "snake_case" });

  return { db, pool, close };
}

export type AgentMemoryDatabase = ReturnType<typeof createDatabase>["db"];
