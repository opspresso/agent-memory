import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { OrganizationAccess } from "@/domain/identity/organization-access";

import { memories, memoryAccessGrants } from "../schema";

// Single SQL owner of the tenant scope policy. These builders must stay
// equivalent to canAccessScopedResource in src/domain/identity — the
// equivalence is pinned by an integration test.
export interface ScopeColumns {
  readonly scopeKind: AnyPgColumn;
  readonly teamId: AnyPgColumn;
  readonly userId: AnyPgColumn;
}

function isOrganizationManager(access: OrganizationAccess): boolean {
  return access.role === "admin" || access.role === "owner";
}

export function scopedReadPredicate(
  access: OrganizationAccess,
  columns: ScopeColumns,
  additional?: SQL
): SQL {
  const teamIds = access.teams.map((team) => team.teamId);
  return or(
    eq(columns.scopeKind, "organization"),
    and(eq(columns.scopeKind, "user"), eq(columns.userId, access.userId)),
    isOrganizationManager(access)
      ? eq(columns.scopeKind, "team")
      : teamIds.length > 0
        ? and(eq(columns.scopeKind, "team"), inArray(columns.teamId, teamIds))
        : undefined,
    additional
  )!;
}

export function scopedManagePredicate(
  access: OrganizationAccess,
  columns: ScopeColumns
): SQL {
  const managedTeamIds = access.teams
    .filter((team) => team.role === "manager")
    .map((team) => team.teamId);
  return or(
    isOrganizationManager(access)
      ? eq(columns.scopeKind, "organization")
      : undefined,
    and(eq(columns.scopeKind, "user"), eq(columns.userId, access.userId)),
    isOrganizationManager(access)
      ? eq(columns.scopeKind, "team")
      : managedTeamIds.length > 0
        ? and(
            eq(columns.scopeKind, "team"),
            inArray(columns.teamId, managedTeamIds)
          )
        : undefined
  )!;
}

export function memoryReadPredicate(access: OrganizationAccess): SQL {
  const teamIds = access.teams.map((team) => team.teamId);
  const grantPrincipal = or(
    and(
      eq(memoryAccessGrants.principalKind, "user"),
      eq(memoryAccessGrants.userId, access.userId)
    ),
    teamIds.length > 0
      ? and(
          eq(memoryAccessGrants.principalKind, "team"),
          inArray(memoryAccessGrants.teamId, teamIds)
        )
      : undefined
  );
  return scopedReadPredicate(
    access,
    memories,
    sql`EXISTS (
      SELECT 1 FROM ${memoryAccessGrants}
      WHERE ${memoryAccessGrants.organizationId} = ${memories.organizationId}
        AND ${memoryAccessGrants.memoryId} = ${memories.id}
        AND ${grantPrincipal}
    )`
  );
}
