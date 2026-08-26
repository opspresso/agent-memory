import { and, asc, count, eq } from "drizzle-orm";

import type { OrganizationAdministrationRepository } from "@/domain/identity/organization-administration-repository";

import type { AgentMemoryDatabase } from "../client";
import {
  organizationMembers,
  organizations,
  teamMembers,
  teams,
  users
} from "../schema";

export function createOrganizationAdministrationRepository(
  db: AgentMemoryDatabase
): OrganizationAdministrationRepository {
  return {
    async createOrganization(organization, ownerUserId) {
      return db.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(organizations)
          .values(organization)
          .onConflictDoNothing({ target: organizations.slug })
          .returning();
        if (!created) {
          return { status: "slug_conflict" } as const;
        }
        await transaction.insert(organizationMembers).values({
          organizationId: created.id,
          userId: ownerUserId,
          role: "owner",
          createdAt: organization.createdAt
        });
        return { status: "created", organization: created } as const;
      });
    },

    async listOrganizationMembers(organizationId) {
      return db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: organizationMembers.role,
          createdAt: organizationMembers.createdAt
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId))
        .orderBy(asc(users.name), asc(users.id));
    },

    async upsertOrganizationMember(organizationId, email, role) {
      const [user] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!user) {
        return { status: "user_not_found" };
      }
      const [existing] = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, user.id)
          )
        )
        .limit(1);
      if (existing?.role === "owner" && role !== "owner") {
        const [owners] = await db
          .select({ total: count() })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.role, "owner")
            )
          );
        if (!owners || owners.total <= 1) {
          return { status: "owner_immutable" };
        }
      }

      const [saved] = await db
        .insert(organizationMembers)
        .values({ organizationId, userId: user.id, role })
        .onConflictDoUpdate({
          target: [
            organizationMembers.organizationId,
            organizationMembers.userId
          ],
          set: { role }
        })
        .returning({
          role: organizationMembers.role,
          createdAt: organizationMembers.createdAt
        });
      if (!saved) {
        throw new Error("organization member upsert returned no row");
      }
      return {
        status: "saved",
        member: {
          userId: user.id,
          email: user.email,
          name: user.name,
          ...saved
        }
      };
    },

    async createTeam(team) {
      const [created] = await db
        .insert(teams)
        .values(team)
        .onConflictDoNothing({
          target: [teams.organizationId, teams.slug]
        })
        .returning();
      return created
        ? { status: "created", team: created }
        : { status: "slug_conflict" };
    },

    async listTeams(organizationId) {
      return db
        .select()
        .from(teams)
        .where(eq(teams.organizationId, organizationId))
        .orderBy(asc(teams.name), asc(teams.id));
    },

    async upsertTeamMember(organizationId, teamId, email, role) {
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(
            eq(teams.organizationId, organizationId),
            eq(teams.id, teamId)
          )
        )
        .limit(1);
      if (!team) {
        return { status: "team_not_found" };
      }
      const [member] = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(users.email, email)
          )
        )
        .limit(1);
      if (!member) {
        return { status: "organization_member_not_found" };
      }

      const [saved] = await db
        .insert(teamMembers)
        .values({
          organizationId,
          teamId,
          userId: member.userId,
          role
        })
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.userId],
          set: { role }
        })
        .returning({
          role: teamMembers.role,
          createdAt: teamMembers.createdAt
        });
      if (!saved) {
        throw new Error("team member upsert returned no row");
      }
      return { status: "saved", member: { ...member, teamId, ...saved } };
    }
  };
}
