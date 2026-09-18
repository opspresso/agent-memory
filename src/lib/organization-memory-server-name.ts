function slugifyOrganizationName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function organizationMemoryServerName(
  organizationName: string,
  organizationSlug: string
): string {
  const base = slugifyOrganizationName(organizationName) || organizationSlug;
  return base.endsWith("-memory") ? base : `${base}-memory`;
}
