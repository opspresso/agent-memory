import type { Instrumentation } from "next";

let shutdownRegistered = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { assertProductionBootstrapConfiguration } = await import(
    "./lib/production-config"
  );
  assertProductionBootstrapConfiguration();

  const { prepareDatabase } = await import("./lib/prepare-database");
  await prepareDatabase();

  const { applyRuntimeSettingsOverrides } = await import(
    "./lib/runtime-settings"
  );
  await applyRuntimeSettingsOverrides();

  const { installationRepository } = await import("./lib/installation");
  await installationRepository.initialize();

  const { assertProductionConfiguration } = await import(
    "./lib/production-config"
  );
  assertProductionConfiguration();

  const { initializeKnowledgeGraph, neo4jDriver } = await import("./lib/neo4j");
  await initializeKnowledgeGraph();

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
          { name: "Neo4j driver", execute: () => neo4jDriver.close() },
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
