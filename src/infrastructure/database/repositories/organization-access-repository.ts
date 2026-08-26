import { and, asc, eq } from "drizzle-orm";

import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";

import type { AgentMemoryDatabase } from "../client";
import { organizationMembers, organizations, teamMembers } from "../schema";

export function createOrganizationAccessRepository(
  db: AgentMemoryDatabase
): OrganizationAccessRepository {
  return {
    async listByUser(userId) {
      return db
        .select({
          id: organizations.id,
          slug: organizations.slug,
          name: organizations.name,
          role: organizationMembers.role
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
      const rows = await db
        .select({
          organizationRole: organizationMembers.role,
          teamId: teamMembers.teamId,
          teamRole: teamMembers.role
        })
        .from(organizationMembers)
        .leftJoin(
          teamMembers,
          and(
            eq(teamMembers.organizationId, organizationMembers.organizationId),
            eq(teamMembers.userId, organizationMembers.userId)
          )
        )
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId)
          )
        );

      const membership = rows[0];
      if (!membership) {
        return null;
      }

      return {
        organizationId,
        userId,
        role: membership.organizationRole,
        teams: rows.flatMap((row) =>
          row.teamId && row.teamRole
            ? [{ teamId: row.teamId, role: row.teamRole }]
            : []
        )
      };
    }
  };
}
