const defaultAllowedEmailDomains = ["nalbam.com"] as const;
const defaultAdminEmails = ["me@nalbam.com"] as const;

interface AccessControlEnvironment {
  readonly [key: string]: string | undefined;
  readonly ADMIN_EMAILS?: string;
  readonly ALLOWED_EMAIL_DOMAINS?: string;
}

function parseList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function configuredList(
  value: string | undefined,
  fallback: readonly string[]
): readonly string[] {
  return value === undefined ? fallback : parseList(value);
}

export function getAllowedEmailDomains(
  environment: AccessControlEnvironment = process.env
): readonly string[] {
  return configuredList(
    environment.ALLOWED_EMAIL_DOMAINS,
    defaultAllowedEmailDomains
  );
}

export function getAdminEmails(
  environment: AccessControlEnvironment = process.env
): readonly string[] {
  return configuredList(environment.ADMIN_EMAILS, defaultAdminEmails);
}

export function isAllowedEmailDomain(
  email: string,
  allowedDomains: readonly string[] = getAllowedEmailDomains()
): boolean {
  if (allowedDomains.length === 0) {
    return true;
  }
  const parts = email.trim().toLowerCase().split("@");
  const domain = parts[1];
  return (
    parts.length === 2 &&
    domain !== undefined &&
    allowedDomains.includes(domain)
  );
}

export function isAdminEmail(
  email: string,
  adminEmails: readonly string[] = getAdminEmails()
): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}
