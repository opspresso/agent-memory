import {
  canAccessScopedResource,
  type MemoryAccessAction,
  type OrganizationAccess
} from "@/domain/identity/organization-access";

import type { Memory } from "./memory";

const permissionLevel: Readonly<Record<MemoryAccessAction, number>> = {
  read: 1,
  write: 2,
  manage: 3
};

export function canAccessMemory(
  access: OrganizationAccess,
  action: MemoryAccessAction,
  memory: Memory
): boolean {
  if (canAccessScopedResource(access, action, memory.scope)) {
    return true;
  }
  if (access.organizationId !== memory.scope.organizationId) {
    return false;
  }
  if (access.principalKind === "organization-agent") {
    return false;
  }

  return memory.accessGrants.some((grant) => {
    if (permissionLevel[grant.permission] < permissionLevel[action]) {
      return false;
    }
    if (grant.principalKind === "user") {
      return grant.userId === access.userId;
    }

    return access.teams.some((team) => team.teamId === grant.teamId);
  });
}
