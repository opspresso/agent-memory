import { readDurableAiRequestLimits } from "@/infrastructure/ai/postgres-request-limiter";
import { readAiRequestLimits } from "@/infrastructure/ai/request-limiter";
import { readDocumentUploadLimits } from "./document-upload-limits";
import { readMetricsToken } from "./metrics-auth";
import { readKnowledgeEnrichmentConcurrency } from "./document-worker-configuration";
import { readKnowledgeExtractionLanguage } from "./knowledge-extraction-configuration";
import { assertProductionConfiguration } from "./production-config";
import { readNeo4jConfiguration } from "./neo4j-configuration";
import { readKnowledgeVerificationConfiguration } from "./knowledge-verification-configuration";

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
  const value = environment[name];
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
}

export function validateRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): void {
  readKnowledgeEnrichmentConcurrency(environment);
  readKnowledgeExtractionLanguage(environment);
  readKnowledgeVerificationConfiguration(environment);
  readNeo4jConfiguration(environment);
  assertProductionConfiguration(environment);
  for (const name of ["S3_BUCKET", "S3_REGION", "S3_ENDPOINT"]) {
    if (environment[name] !== undefined && !environment[name]?.trim()) {
      throw new Error(`${name} must not be empty`);
    }
  }
  paired(environment, ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
  for (const name of [
    "BETTER_AUTH_URL", "EMBEDDING_BASE_URL", "RERANKER_BASE_URL",
    "KNOWLEDGE_EXTRACTION_BASE_URL", "KNOWLEDGE_VERIFICATION_BASE_URL", "OIDC_ISSUER", "S3_ENDPOINT",
    "LANGFUSE_BASE_URL"
  ]) {
    const value = environment[name];
    if (value === undefined || (value === "" && name !== "BETTER_AUTH_URL")) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be an absolute HTTP(S) URL`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${name} must be an absolute HTTP(S) URL without credentials`);
    }
  }
  paired(environment, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  paired(environment, ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]);
  paired(environment, ["RERANKER_BASE_URL", "RERANKER_MODEL"]);
  paired(environment, ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
  if (
    !environment.GOOGLE_CLIENT_ID?.trim() &&
    !environment.OIDC_ISSUER?.trim() &&
    environment.AUTH_PASSWORD !== "true"
  ) {
    throw new Error("At least one login method must remain enabled");
  }
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
  if (exportMode !== undefined && exportMode !== "batched" && exportMode !== "immediate") {
    throw new Error("LANGFUSE_EXPORT_MODE must be batched or immediate");
  }
  const logLevel = environment.LOG_LEVEL;
  if (
    logLevel !== undefined &&
    !["trace", "debug", "info", "warn", "error", "fatal", "silent"].includes(
      logLevel
    )
  ) {
    throw new Error("LOG_LEVEL is invalid");
  }
}
