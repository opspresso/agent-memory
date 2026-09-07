import { createAppSettingsUseCases } from "@/application/settings/manage-app-settings";
import { appSettingDefinitions } from "@/domain/settings/app-settings";
import { readDurableAiRequestLimits } from "@/infrastructure/ai/postgres-request-limiter";
import { readAiRequestLimits } from "@/infrastructure/ai/request-limiter";
import { createAppSettingsRepository } from "@/infrastructure/database/repositories/app-settings-repository";
import { createAppSettingsSecretCipher } from "@/infrastructure/security/app-settings-secret";

import { getAdminEmails, getAllowedEmailDomains } from "./access-control";
import { database } from "./database";
import { readDocumentUploadLimits } from "./document-upload-limits";
import { readMetricsToken } from "./metrics-auth";
import { assertProductionConfiguration } from "./production-config";

const baseEnvironment: Readonly<Record<string, string | undefined>> = {
  ...process.env
};
const settingsSecret = baseEnvironment.BETTER_AUTH_SECRET;
const settingsRepository = createAppSettingsRepository(database.db);
const settingsCipher = createAppSettingsSecretCipher(() => settingsSecret);
const cacheTtlMilliseconds = 5_000;

function paired(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[]
): void {
  const configured = names.filter((name) => Boolean(environment[name]?.trim()));
  if (configured.length !== 0 && configured.length !== names.length) {
    throw new Error(`${names.join(", ")} must be set together`);
  }
}

function optionalPositiveInteger(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): void {
  const raw = environment[name]?.trim();
  if (raw && (!Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function booleanSetting(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): void {
  const value = environment[name]?.trim();
  if (value && value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
}

function validateRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): void {
  assertProductionConfiguration(environment);
  paired(environment, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  paired(environment, ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]);
  paired(environment, ["RERANKER_BASE_URL", "RERANKER_MODEL"]);
  paired(environment, ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
  for (const name of [
    "DOCUMENT_WORKER_ENABLED",
    "AUTH_PASSWORD",
    "AUTH_PASSWORD_SIGNUP",
    "S3_FORCE_PATH_STYLE"
  ]) {
    booleanSetting(environment, name);
  }
  if (
    environment.AUTH_PASSWORD_SIGNUP === "true" &&
    environment.AUTH_PASSWORD !== "true"
  ) {
    throw new Error("AUTH_PASSWORD must be true when AUTH_PASSWORD_SIGNUP is true");
  }
  if (
    environment.EMBEDDING_MODEL?.trim() &&
    !environment.EMBEDDING_BASE_URL?.trim()
  ) {
    throw new Error("EMBEDDING_BASE_URL must be set when EMBEDDING_MODEL is enabled");
  }
  if (
    environment.KNOWLEDGE_EXTRACTION_MODEL?.trim() &&
    !environment.KNOWLEDGE_EXTRACTION_BASE_URL?.trim()
  ) {
    throw new Error(
      "KNOWLEDGE_EXTRACTION_BASE_URL must be set when KNOWLEDGE_EXTRACTION_MODEL is enabled"
    );
  }
  optionalPositiveInteger(environment, "RERANKER_TIMEOUT_MS");
  const minimumScore = environment.RERANKER_MIN_SCORE?.trim();
  if (
    minimumScore &&
    (!Number.isFinite(Number(minimumScore)) ||
      Number(minimumScore) < 0 ||
      Number(minimumScore) > 1)
  ) {
    throw new Error("RERANKER_MIN_SCORE must be between 0 and 1");
  }
  readAiRequestLimits(environment);
  readDurableAiRequestLimits(environment);
  readDocumentUploadLimits(environment);
  readMetricsToken(environment);
  const exportMode = environment.LANGFUSE_EXPORT_MODE?.trim();
  if (exportMode && exportMode !== "batched" && exportMode !== "immediate") {
    throw new Error("LANGFUSE_EXPORT_MODE must be batched or immediate");
  }
  const logLevel = environment.LOG_LEVEL?.trim();
  if (
    logLevel &&
    !["trace", "debug", "info", "warn", "error", "fatal", "silent"].includes(
      logLevel
    )
  ) {
    throw new Error("LOG_LEVEL is invalid");
  }
}

export const appSettingsUseCases = createAppSettingsUseCases({
  cipher: settingsCipher,
  clock: () => new Date(),
  environment: baseEnvironment,
  repository: settingsRepository,
  validate: validateRuntimeEnvironment
});

let cache:
  | {
      readonly environment: Readonly<Record<string, string | undefined>>;
      readonly fetchedAt: number;
    }
  | undefined;

let cacheGeneration = 0;

export function invalidateRuntimeSettingsCache(): void {
  cacheGeneration += 1;
  cache = undefined;
}

export async function getEffectiveRuntimeEnvironment(): Promise<
  Readonly<Record<string, string | undefined>>
> {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > cacheTtlMilliseconds) {
    const generation = cacheGeneration;
    const environment = await appSettingsUseCases.getEffectiveEnvironment();
    if (generation !== cacheGeneration) {
      return getEffectiveRuntimeEnvironment();
    }
    cache = {
      environment,
      fetchedAt: now
    };
  }
  return cache.environment;
}

async function applyRuntimeSettingsOverridesMatching(
  include: (restartRequired: boolean) => boolean
): Promise<void> {
  invalidateRuntimeSettingsCache();
  const environment = await getEffectiveRuntimeEnvironment();
  for (const definition of appSettingDefinitions) {
    if (!include(definition.restartRequired)) {
      continue;
    }
    const value = environment[definition.name];
    if (value === undefined) {
      delete process.env[definition.name];
    } else {
      process.env[definition.name] = value;
    }
  }
}

export async function applyRuntimeSettingsOverrides(): Promise<void> {
  await applyRuntimeSettingsOverridesMatching(() => true);
}

export async function applyLiveRuntimeSettingsOverrides(): Promise<void> {
  await applyRuntimeSettingsOverridesMatching(
    (restartRequired) => !restartRequired
  );
}

export async function getEffectiveAllowedEmailDomains(): Promise<readonly string[]> {
  return getAllowedEmailDomains(await getEffectiveRuntimeEnvironment());
}

export async function getEffectiveAdminEmails(): Promise<readonly string[]> {
  return getAdminEmails(await getEffectiveRuntimeEnvironment());
}
