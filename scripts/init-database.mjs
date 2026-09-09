import pg from "pg";
import { initializeSchema } from "../src/infrastructure/database/schema-bootstrap.mjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required; no default database is selected.");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await initializeSchema(pool);
  console.log("Database schema is ready.");
} finally {
  await pool.end();
}
