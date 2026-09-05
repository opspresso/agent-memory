import { checkDatabaseReadiness } from "@/lib/health-service";
import { logger } from "@/lib/observability";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const startedAt = performance.now();
  try {
    await checkDatabaseReadiness();
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
