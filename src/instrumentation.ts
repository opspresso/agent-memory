import type { Instrumentation } from "next";

let shutdownRegistered = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { assertProductionConfiguration } = await import(
    "./lib/production-config"
  );
  assertProductionConfiguration();

  const { initializeTelemetry, shutdownTelemetry } = await import(
    "./infrastructure/observability/telemetry"
  );

  if (!shutdownRegistered) {
    const [{ logger }, { registerRuntimeShutdown, runRuntimeShutdownSteps }] =
      await Promise.all([
        import("./infrastructure/observability/logger"),
        import("./lib/runtime-lifecycle")
      ]);
    registerRuntimeShutdown(
      async () => {
        const { database, documentIngestionQueue } = await import(
          "./lib/container"
        );
        await runRuntimeShutdownSteps([
          {
            name: "document ingestion queue",
            execute: () => documentIngestionQueue.stop()
          },
          {
            name: "database pool",
            execute: () => database.pool.end()
          },
          { name: "telemetry", execute: shutdownTelemetry }
        ]);
      },
      logger
    );
    shutdownRegistered = true;
  }

  const [{ readAiRequestLimits }, { readMetricsToken }] = await Promise.all([
    import("./infrastructure/ai/request-limiter"),
    import("./lib/metrics-auth")
  ]);
  readAiRequestLimits();
  readMetricsToken();

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
        // request.path carries the full URL including query strings, which can
        // contain search terms — logging those violates the telemetry policy.
        path: request.path.split("?", 1)[0],
        routePath: context.routePath,
        routeType: context.routeType
      },
      "unhandled Next.js request error"
    );
  }
};
