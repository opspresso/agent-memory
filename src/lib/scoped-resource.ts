import type { ScopedResource } from "@/domain/identity/organization-access";

export type ScopedResourceInput =
  | Readonly<{ kind: "organization" }>
  | Readonly<{ kind: "team"; teamId: string }>
  | Readonly<{ kind: "user"; userId?: string }>;

export function resolveScopedResource(
  scope: ScopedResourceInput,
  organizationId: string,
  fallbackUserId: string
): ScopedResource {
  if (scope.kind === "team") {
    return { kind: "team", organizationId, teamId: scope.teamId };
  }
  if (scope.kind === "user") {
    return {
      kind: "user",
      organizationId,
      userId: scope.userId ?? fallbackUserId
    };
  }
  return { kind: "organization", organizationId };
}
