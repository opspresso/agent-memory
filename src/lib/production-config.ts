const requiredProductionSettings = [
  "DATABASE_URL",
  "ADMIN_EMAILS",
  "ALLOWED_EMAIL_DOMAINS",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET"
] as const;

interface ProductionConfigurationEnvironment {
  readonly [key: string]: string | undefined;
  readonly NODE_ENV?: string;
}

export function assertProductionConfiguration(
  environment: ProductionConfigurationEnvironment = process.env
): void {
  if (environment.NODE_ENV !== "production") {
    return;
  }
  const missing = requiredProductionSettings.filter(
    (name) => !environment[name]?.trim()
  );
  if (missing.length > 0) {
    throw new Error(
      `production configuration is incomplete: ${missing.join(", ")} must be set`
    );
  }
}
