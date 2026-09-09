import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export function readSchemaArtifact() {
  const sql = readFileSync(path.join(process.cwd(), "database/schema.sql"), "utf8");
  return { sql, hash: createHash("sha256").update(sql).digest("hex") };
}

// Bootstrap only an empty installation. Schema changes require an explicit
// reset by the operator; application startup never transforms or deletes data.
export async function initializeSchema(pool) {
  const artifact = readSchemaArtifact();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('agent-memory-schema', 0))");
    const state = await client.query("SELECT to_regclass('public.application_schema') IS NOT NULL AS present");
    if (state.rows[0]?.present) {
      const version = await client.query("SELECT fingerprint FROM public.application_schema WHERE id = 1");
      if (version.rows[0]?.fingerprint !== artifact.hash) {
        throw new Error("Database schema does not match this application. Explicitly reset the installation before deployment.");
      }
    } else {
      const existing = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') LIMIT 1`);
      if (existing.rows.length) {
        throw new Error("Database is not empty. Explicitly reset the installation before initialization.");
      }
      await client.query(artifact.sql);
      await client.query("CREATE TABLE public.application_schema (id integer PRIMARY KEY CHECK (id = 1), fingerprint text NOT NULL)");
      await client.query("INSERT INTO public.application_schema (id, fingerprint) VALUES (1, $1)", [artifact.hash]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
