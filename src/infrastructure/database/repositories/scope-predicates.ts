import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { OrganizationAccess, ScopedResource } from "@/domain/identity/organization-access";

import { memories, memoryAccessGrants } from "../schema";

// Single SQL owner of the tenant scope policy. These builders must stay
// equivalent to canAccessScopedResource in src/domain/identity — the
// equivalence is pinned by an integration test.
export interface ScopeColumns {
  readonly scopeKind: AnyPgColumn;
  readonly teamId: AnyPgColumn;
  readonly userId: AnyPgColumn;
}

/** SQL counterpart of scopeCovers, independent of the acting user's extra grants. */
export function scopeCoveragePredicate(
  source: ScopeColumns & { readonly organizationId: AnyPgColumn },
  target: ScopedResource | (ScopeColumns & { readonly organizationId: AnyPgColumn })
): SQL {
  const destination = "scopeKind" in target ? target : {
    organizationId: target.organizationId, scopeKind: target.kind,
    teamId: target.kind === "team" ? target.teamId : null,
    userId: target.kind === "user" ? target.userId : null
  };
  return sql`(${source.organizationId} = ${destination.organizationId} AND (
    ${source.scopeKind} = 'organization'
    OR (${source.scopeKind} = 'team' AND ${destination.scopeKind} = 'team' AND ${source.teamId} = ${destination.teamId})
    OR (${source.scopeKind} = 'user' AND ${destination.scopeKind} = 'user' AND ${source.userId} = ${destination.userId})
  ))`;
}

function isOrganizationManager(access: OrganizationAccess): boolean {
  return access.role === "admin" || access.role === "owner";
}

export function scopedReadPredicate(
  access: OrganizationAccess,
  columns: ScopeColumns,
  additional?: SQL
): SQL {
  if (access.principalKind === "organization-agent") {
    return eq(columns.scopeKind, "organization");
  }
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
  if (access.principalKind === "organization-agent") {
    return isOrganizationManager(access)
      ? eq(columns.scopeKind, "organization")
      : sql`false`;
  }
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
  if (access.principalKind === "organization-agent") {
    return scopedReadPredicate(access, memories);
  }
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
