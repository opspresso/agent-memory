const requiredProductionSettings = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "ADMIN_EMAILS",
  "ALLOWED_EMAIL_DOMAINS",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET"
] as const;

interface ProductionConfigurationEnvironment {
  readonly [key: string]: string | undefined;
  readonly AUTH_PASSWORD_SIGNUP?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
  readonly NODE_ENV?: string;
}

function isLoopbackHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

function productionBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("BETTER_AUTH_URL must use HTTPS outside loopback environments");
  }
  return url;
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
  if ((environment.BETTER_AUTH_SECRET?.trim().length ?? 0) < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  const authUrl = productionBaseUrl(environment.BETTER_AUTH_URL ?? "");
  if (
    !isLoopbackHostname(authUrl.hostname) &&
    environment.AUTH_PASSWORD_SIGNUP === "true"
  ) {
    throw new Error(
      "AUTH_PASSWORD_SIGNUP cannot be enabled on a public production origin without email verification"
    );
  }
}
