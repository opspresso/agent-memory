import { sql } from "drizzle-orm";

import { database } from "@/lib/container";
import { logger } from "@/lib/observability";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const startedAt = performance.now();
  try {
    await database.db.execute(sql`select 1`);
    return Response.json(
      { status: "ok", checks: { database: "ok" } },
      { headers }
    );
  } catch (error) {
    logger.error(
      {
        err: error,
        durationMs: Math.round(performance.now() - startedAt)
      },
      "readiness check failed"
    );
    return Response.json(
      { status: "unavailable", checks: { database: "failed" } },
      { status: 503, headers }
    );
  }
}
