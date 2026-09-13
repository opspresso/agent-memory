import type { AppSettingName } from "@/domain/settings/app-settings";

export const applicationSections = ["ai", "document", "auth", "storage", "observability"] as const;
export type ApplicationSection = typeof applicationSections[number];
export type SettingsSection = "general" | "ontology" | ApplicationSection;

export const settingGroups = [
  { section: "ai", key: "embedding", names: ["EMBEDDING_BASE_URL", "EMBEDDING_MODEL", "EMBEDDING_API_KEY"] },
  { section: "ai", key: "reranker", names: ["RERANKER_BASE_URL", "RERANKER_MODEL", "RERANKER_API_KEY", "RERANKER_TIMEOUT_MS", "RERANKER_MIN_SCORE"] },
  { section: "ai", key: "extraction", names: ["KNOWLEDGE_EXTRACTION_BASE_URL", "KNOWLEDGE_EXTRACTION_MODEL", "KNOWLEDGE_EXTRACTION_LANGUAGE", "KNOWLEDGE_EXTRACTION_API_KEY"] },
  { section: "ai", key: "verification", names: ["KNOWLEDGE_VERIFICATION_BASE_URL", "KNOWLEDGE_VERIFICATION_MODEL", "KNOWLEDGE_VERIFICATION_API_KEY"] },
  { section: "ai", key: "limits", names: ["AI_PROVIDER_MAX_CONCURRENCY", "AI_PROVIDER_REQUESTS_PER_MINUTE", "AI_ORGANIZATION_REQUESTS_PER_MINUTE", "AI_USER_REQUESTS_PER_MINUTE"] },
  { section: "document", key: "worker", names: ["DOCUMENT_WORKER_ENABLED", "KNOWLEDGE_ENRICHMENT_CONCURRENCY"] },
  { section: "document", key: "quotas", names: ["DOCUMENT_STORAGE_QUOTA_BYTES", "DOCUMENT_PENDING_QUOTA", "DOCUMENT_UPLOADS_PER_USER_PER_HOUR"] },
  { section: "auth", key: "access", names: ["BETTER_AUTH_URL", "ALLOWED_EMAIL_DOMAINS", "ADMIN_EMAILS"] },
  { section: "auth", key: "password", names: ["AUTH_PASSWORD", "AUTH_PASSWORD_SIGNUP"] },
  { section: "auth", key: "google", names: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  { section: "auth", key: "oidc", names: ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_SCOPES"] },
  { section: "storage", key: "bucket", names: ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE"] },
  { section: "storage", key: "storageCredentials", names: ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] },
  { section: "observability", key: "logging", names: ["LOG_LEVEL", "METRICS_BEARER_TOKEN"] },
  { section: "observability", key: "tracing", names: ["LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_EXPORT_MODE", "LANGFUSE_TRACING_ENVIRONMENT"] }
] as const satisfies readonly { section: ApplicationSection; key: string; names: readonly AppSettingName[] }[];

export const booleanSettings = new Set<AppSettingName>(["DOCUMENT_WORKER_ENABLED", "AUTH_PASSWORD", "AUTH_PASSWORD_SIGNUP", "S3_FORCE_PATH_STYLE"]);
export const numericSettings: Partial<Record<AppSettingName, { min: number; max?: number; suffix: string; decimal?: boolean }>> = {
  KNOWLEDGE_ENRICHMENT_CONCURRENCY: { min: 1, max: 16, suffix: "" },
  AI_PROVIDER_MAX_CONCURRENCY: { min: 1, suffix: "" },
  AI_PROVIDER_REQUESTS_PER_MINUTE: { min: 1, suffix: " / min" },
  AI_ORGANIZATION_REQUESTS_PER_MINUTE: { min: 1, suffix: " / min" },
  AI_USER_REQUESTS_PER_MINUTE: { min: 1, suffix: " / min" },
  DOCUMENT_STORAGE_QUOTA_BYTES: { min: 1, suffix: " bytes" },
  DOCUMENT_PENDING_QUOTA: { min: 1, suffix: "" },
  DOCUMENT_UPLOADS_PER_USER_PER_HOUR: { min: 1, suffix: " / h" },
  RERANKER_TIMEOUT_MS: { min: 1, suffix: " ms" },
  RERANKER_MIN_SCORE: { min: 0, max: 1, suffix: "", decimal: true }
};
export const choiceSettings: Partial<Record<AppSettingName, readonly string[]>> = {
  KNOWLEDGE_EXTRACTION_LANGUAGE: ["source", "ko", "en"],
  LOG_LEVEL: ["trace", "debug", "info", "warn", "error", "fatal", "silent"],
  LANGFUSE_EXPORT_MODE: ["batched", "immediate"]
};

export function editSettingDraft(draft: Partial<Record<AppSettingName, string>>, name: AppSettingName, value: string, savedValue: string, secret: boolean) {
  const next = { ...draft };
  if (value === (secret ? "" : savedValue)) { delete next[name]; }
  else { next[name] = value; }
  return next;
}

export function resolveSettingsSection(requested: string | null, isAdmin: boolean, canManageOrganization: boolean): SettingsSection | undefined {
  const allowed: readonly SettingsSection[] = [...(canManageOrganization ? ["general", "ontology"] as const : []), ...(isAdmin ? applicationSections : [])];
  return allowed.find((section) => section === requested) ?? (isAdmin ? "ai" : canManageOrganization ? "general" : undefined);
}
