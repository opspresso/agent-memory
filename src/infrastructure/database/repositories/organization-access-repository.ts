import { and, asc, eq } from "drizzle-orm";

import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";

import type { AgentMemoryDatabase } from "../client";
import { organizationMembers, organizations, teamMembers } from "../schema";

export function createOrganizationAccessRepository(
  db: AgentMemoryDatabase
): OrganizationAccessRepository {
  async function findAccess(
    organizationPredicate: ReturnType<typeof eq>,
    userId: string
  ) {
    const rows = await db
      .select({
        organizationId: organizations.id,
        organizationRole: organizationMembers.role,
        teamId: teamMembers.teamId,
        teamRole: teamMembers.role
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId)
      )
      .leftJoin(
        teamMembers,
        and(
          eq(teamMembers.organizationId, organizationMembers.organizationId),
          eq(teamMembers.userId, organizationMembers.userId)
        )
      )
      .where(
        and(
          organizationPredicate,
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.status, "active")
        )
      );

    const membership = rows[0];
    if (!membership) {
      return null;
    }

    return {
      organizationId: membership.organizationId,
      userId,
      role: membership.organizationRole,
      teams: rows.flatMap((row) =>
        row.teamId && row.teamRole
          ? [{ teamId: row.teamId, role: row.teamRole }]
          : []
      )
    };
  }

  return {
    async listByUser(userId) {
      return db
        .select({
          id: organizations.id,
          slug: organizations.slug,
          name: organizations.name,
          role: organizationMembers.role,
          status: organizationMembers.status
        })
        .from(organizationMembers)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId)
        )
        .where(eq(organizationMembers.userId, userId))
        .orderBy(asc(organizations.name), asc(organizations.id));
    },

    async findByUser(organizationId, userId) {
      return findAccess(eq(organizations.id, organizationId), userId);
    },

    async findBySlug(organizationSlug, userId) {
      return findAccess(eq(organizations.slug, organizationSlug), userId);
    }
  };
}
