import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { initializeTelemetry } = await import(
    "./infrastructure/observability/telemetry"
  );
  initializeTelemetry();

  if (process.env.MIGRATE_ON_START === "true") {
    const { migrateOnStart } = await import("./lib/migrate-on-start");
    await migrateOnStart();
  }

  if (process.env.DOCUMENT_WORKER_ENABLED === "true") {
    const { startDocumentWorker } = await import("./lib/document-worker");
    await startDocumentWorker();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("./infrastructure/observability/logger");
    logger.error(
      {
        err: error,
        method: request.method,
        path: request.path,
        routePath: context.routePath,
        routeType: context.routeType
      },
      "unhandled Next.js request error"
    );
  }
};
