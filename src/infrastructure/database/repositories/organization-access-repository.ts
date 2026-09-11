import { and, asc, eq, ne } from "drizzle-orm";

import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";

import type { AgentMemoryDatabase } from "../client";
import {
  organizationMembers,
  organizations,
  teamMembers,
  users
} from "../schema";

export function createOrganizationAccessRepository(
  db: Pick<AgentMemoryDatabase, "select">
): OrganizationAccessRepository {
  async function findAccess(
    organizationPredicate: ReturnType<typeof eq>,
    userPredicate: ReturnType<typeof eq>
  ) {
    const rows = await db
      .select({
        organizationId: organizations.id,
        userId: organizationMembers.userId,
        organizationRole: organizationMembers.role,
        teamId: teamMembers.teamId,
        teamRole: teamMembers.role
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId)
      )
      .innerJoin(users, eq(users.id, organizationMembers.userId))
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
          userPredicate,
          eq(organizationMembers.status, "active")
        )
      );

    const membership = rows[0];
    if (!membership) {
      return null;
    }

    return {
      organizationId: membership.organizationId,
      userId: membership.userId,
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
        .where(
          and(
            eq(organizationMembers.userId, userId),
            ne(organizationMembers.status, "removed")
          )
        )
        .orderBy(asc(organizations.name), asc(organizations.id));
    },

    async findByUser(organizationId, userId) {
      return findAccess(
        eq(organizations.id, organizationId),
        eq(organizationMembers.userId, userId)
      );
    },

    async findBySlug(organizationSlug, userId) {
      return findAccess(
        eq(organizations.slug, organizationSlug),
        eq(organizationMembers.userId, userId)
      );
    },

    async findByEmail(organizationId, email) {
      return findAccess(
        eq(organizations.id, organizationId),
        eq(users.email, email)
      );
    }
  };
}
