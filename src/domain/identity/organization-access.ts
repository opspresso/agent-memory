export const organizationRoles = ["member", "admin", "owner"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];

export const teamRoles = ["member", "manager"] as const;
export type TeamRole = (typeof teamRoles)[number];

export interface TeamAccess {
  readonly teamId: string;
  readonly role: TeamRole;
}

export interface OrganizationAccess {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly teams: readonly TeamAccess[];
}

export type MemoryAccessAction = "read" | "write" | "manage";

export type ScopedResource =
  | Readonly<{ kind: "organization"; organizationId: string }>
  | Readonly<{ kind: "team"; organizationId: string; teamId: string }>
  | Readonly<{ kind: "user"; organizationId: string; userId: string }>;

export function canAccessScopedResource(
  access: OrganizationAccess,
  action: MemoryAccessAction,
  scope: ScopedResource
): boolean {
  if (access.organizationId !== scope.organizationId) {
    return false;
  }

  if (scope.kind === "organization") {
    return action === "read" || access.role === "admin" || access.role === "owner";
  }

  if (scope.kind === "user") {
    return scope.userId === access.userId;
  }

  if (access.role === "admin" || access.role === "owner") {
    return true;
  }

  const team = access.teams.find((candidate) => candidate.teamId === scope.teamId);
  if (!team) {
    return false;
  }

  return action !== "manage" || team.role === "manager";
}
