export const appSettingDefinitions = [
  { name: "DOCUMENT_WORKER_ENABLED", defaultValue: "false", restartRequired: true },
  { name: "BETTER_AUTH_URL", defaultValue: "http://localhost:3100", restartRequired: true },
  { name: "AUTH_PASSWORD", defaultValue: "false", restartRequired: true },
  { name: "AUTH_PASSWORD_SIGNUP", defaultValue: "false", restartRequired: true },
  { name: "ALLOWED_EMAIL_DOMAINS", defaultValue: "", restartRequired: false },
  { name: "ADMIN_EMAILS", defaultValue: "me@nalbam.com", restartRequired: false },
  { name: "GOOGLE_CLIENT_ID", restartRequired: true },
  { name: "GOOGLE_CLIENT_SECRET", secret: true, restartRequired: true },
  { name: "OIDC_ISSUER", restartRequired: true },
  { name: "OIDC_CLIENT_ID", restartRequired: true },
  { name: "OIDC_CLIENT_SECRET", secret: true, restartRequired: true },
  { name: "OIDC_SCOPES", defaultValue: "openid email profile", restartRequired: true },
  { name: "EMBEDDING_BASE_URL", restartRequired: true },
  { name: "EMBEDDING_API_KEY", secret: true, restartRequired: true },
  { name: "EMBEDDING_MODEL", restartRequired: true },
  { name: "RERANKER_BASE_URL", restartRequired: true },
  { name: "RERANKER_API_KEY", secret: true, restartRequired: true },
  { name: "RERANKER_MODEL", restartRequired: true },
  { name: "RERANKER_TIMEOUT_MS", defaultValue: "5000", restartRequired: true },
  { name: "RERANKER_MIN_SCORE", restartRequired: true },
  { name: "KNOWLEDGE_EXTRACTION_BASE_URL", restartRequired: true },
  { name: "KNOWLEDGE_EXTRACTION_API_KEY", secret: true, restartRequired: true },
  { name: "KNOWLEDGE_EXTRACTION_MODEL", restartRequired: true },
  { name: "KNOWLEDGE_EXTRACTION_LANGUAGE", defaultValue: "ko", restartRequired: true },
  { name: "KNOWLEDGE_VERIFICATION_BASE_URL", restartRequired: true },
  { name: "KNOWLEDGE_VERIFICATION_MODEL", restartRequired: true },
  { name: "KNOWLEDGE_VERIFICATION_API_KEY", secret: true, restartRequired: true },
  { name: "KNOWLEDGE_ENRICHMENT_CONCURRENCY", defaultValue: "4", restartRequired: true },
  { name: "AI_PROVIDER_MAX_CONCURRENCY", defaultValue: "8", restartRequired: true },
  { name: "AI_PROVIDER_REQUESTS_PER_MINUTE", defaultValue: "120", restartRequired: true },
  { name: "AI_ORGANIZATION_REQUESTS_PER_MINUTE", defaultValue: "120", restartRequired: true },
  { name: "AI_USER_REQUESTS_PER_MINUTE", defaultValue: "30", restartRequired: true },
  { name: "DOCUMENT_STORAGE_QUOTA_BYTES", defaultValue: "1073741824", restartRequired: true },
  { name: "DOCUMENT_PENDING_QUOTA", defaultValue: "100", restartRequired: true },
  { name: "DOCUMENT_UPLOADS_PER_USER_PER_HOUR", defaultValue: "100", restartRequired: true },
  { name: "S3_ENDPOINT", defaultValue: "http://localhost:9010", restartRequired: true },
  { name: "S3_REGION", defaultValue: "ap-northeast-2", restartRequired: true },
  { name: "S3_BUCKET", defaultValue: "agent-memory", restartRequired: true },
  { name: "S3_ACCESS_KEY_ID", secret: true, restartRequired: true },
  { name: "S3_SECRET_ACCESS_KEY", secret: true, restartRequired: true },
  { name: "S3_FORCE_PATH_STYLE", defaultValue: "true", restartRequired: true },
  { name: "LOG_LEVEL", defaultValue: "info", restartRequired: true },
  { name: "METRICS_BEARER_TOKEN", secret: true, restartRequired: false },
  { name: "LANGFUSE_PUBLIC_KEY", secret: true, restartRequired: true },
  { name: "LANGFUSE_SECRET_KEY", secret: true, restartRequired: true },
  { name: "LANGFUSE_BASE_URL", defaultValue: "https://cloud.langfuse.com", restartRequired: true },
  { name: "LANGFUSE_EXPORT_MODE", restartRequired: true },
  { name: "LANGFUSE_TRACING_ENVIRONMENT", restartRequired: true }
] as const;

export type AppSettingName = (typeof appSettingDefinitions)[number]["name"];

export interface AppSettings {
  readonly overrides: Readonly<Partial<Record<AppSettingName, string>>>;
  readonly updatedAt: Date;
}

export interface AppSettingsRepository {
  get(): Promise<AppSettings | null>;
  save(settings: AppSettings): Promise<AppSettings>;
  update(mutate: (current: AppSettings | null) => AppSettings): Promise<AppSettings>;
}

export interface AppSettingsSecretCipher {
  decrypt(value: string, name: AppSettingName): string;
  encrypt(value: string, name: AppSettingName): string;
  isMasked(value: string): boolean;
  mask(value: string): string;
}
