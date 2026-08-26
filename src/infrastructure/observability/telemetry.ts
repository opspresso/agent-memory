import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import type { OrganizationAccess } from "@/domain/identity/organization-access";

import { logger } from "./logger";

interface TelemetryEnvironment {
  readonly [key: string]: string | undefined;
  readonly LANGFUSE_BASE_URL?: string;
  readonly LANGFUSE_EXPORT_MODE?: string;
  readonly LANGFUSE_PUBLIC_KEY?: string;
  readonly LANGFUSE_SECRET_KEY?: string;
  readonly LANGFUSE_TRACING_ENVIRONMENT?: string;
  readonly VERCEL?: string;
}

export interface TelemetryConfiguration {
  readonly baseUrl?: string;
  readonly environment?: string;
  readonly exportMode: "batched" | "immediate";
  readonly publicKey: string;
  readonly secretKey: string;
}

let sdk: NodeSDK | undefined;
let processor: LangfuseSpanProcessor | undefined;
let initialized = false;

export function readTelemetryConfiguration(
  environment: TelemetryEnvironment
): TelemetryConfiguration | null {
  const publicKey = environment.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = environment.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey && !secretKey) {
    return null;
  }
  if (!publicKey || !secretKey) {
    throw new Error(
      "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together"
    );
  }
  const configuredMode = environment.LANGFUSE_EXPORT_MODE?.trim();
  if (
    configuredMode !== undefined &&
    configuredMode !== "batched" &&
    configuredMode !== "immediate"
  ) {
    throw new Error("LANGFUSE_EXPORT_MODE must be batched or immediate");
  }

  return {
    publicKey,
    secretKey,
    exportMode: configuredMode ?? (environment.VERCEL ? "immediate" : "batched"),
    ...(environment.LANGFUSE_BASE_URL?.trim()
      ? { baseUrl: environment.LANGFUSE_BASE_URL.trim() }
      : {}),
    ...(environment.LANGFUSE_TRACING_ENVIRONMENT?.trim()
      ? { environment: environment.LANGFUSE_TRACING_ENVIRONMENT.trim() }
      : {})
  };
}

function maskTelemetryData({ data }: { data: unknown }): unknown {
  if (typeof data !== "string") {
    return data;
  }
  return data
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /(password|secret|token|api[_-]?key)(\s*[=:]\s*)\S+/gi,
      "$1$2[REDACTED]"
    );
}

export function initializeTelemetry(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  const configuration = readTelemetryConfiguration(process.env);
  if (!configuration) {
    logger.info("Langfuse telemetry is disabled");
    return;
  }

  processor = new LangfuseSpanProcessor({
    publicKey: configuration.publicKey,
    secretKey: configuration.secretKey,
    exportMode: configuration.exportMode,
    mask: maskTelemetryData,
    mediaUploadEnabled: false,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    ...(configuration.environment
      ? { environment: configuration.environment }
      : {})
  });
  sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  logger.info(
    { exportMode: configuration.exportMode },
    "Langfuse telemetry initialized"
  );
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
  processor = undefined;
  initialized = false;
}

export async function observeRetrieval<T>(
  name: string,
  access: OrganizationAccess,
  limit: number,
  execute: () => Promise<readonly T[]>
): Promise<readonly T[]> {
  const startedAt = performance.now();
  try {
    const result = await propagateAttributes(
      {
        traceName: name,
        userId: access.userId,
        metadata: { organizationId: access.organizationId }
      },
      () =>
        startActiveObservation(
          name,
          async (observation) => {
            observation.update({
              metadata: {
                organizationId: access.organizationId,
                limit
              }
            });
            const values = await execute();
            observation.update({ output: { resultCount: values.length } });
            return values;
          },
          { asType: "retriever" }
        )
    );
    logger.info(
      {
        operation: name,
        organizationId: access.organizationId,
        resultCount: result.length,
        durationMs: Math.round(performance.now() - startedAt)
      },
      "retrieval completed"
    );
    return result;
  } catch (error) {
    logger.error(
      {
        err: error,
        operation: name,
        organizationId: access.organizationId,
        durationMs: Math.round(performance.now() - startedAt)
      },
      "retrieval failed"
    );
    throw error;
  }
}
