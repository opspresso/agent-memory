import { checkDatabaseReadiness, checkKnowledgeGraphReadiness, DatabaseSchemaNotReadyError } from "@/lib/health-service";
import { KnowledgeGraphUnavailableError } from "@/domain/knowledge/knowledge-topology";
import { logger } from "@/lib/observability";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const startedAt = performance.now();
  try {
    await checkDatabaseReadiness();
    await checkKnowledgeGraphReadiness();
    return Response.json(
      { status: "ok", checks: { database: "ok", schema: "ok", neo4j: "ok" } },
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
      { status: "unavailable", checks: error instanceof KnowledgeGraphUnavailableError
        ? { database: "ok", schema: "ok", neo4j: "failed" }
        : error instanceof DatabaseSchemaNotReadyError
          ? { database: "ok", schema: "failed", neo4j: "unknown" }
          : { database: "failed", schema: "unknown", neo4j: "unknown" } },
      { status: 503, headers }
    );
  }
}
