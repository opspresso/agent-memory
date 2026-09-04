import { and, asc, count, eq, notInArray, sql } from "drizzle-orm";

import type { OrganizationAdministrationRepository } from "@/domain/identity/organization-administration-repository";

import type { AgentMemoryDatabase } from "../client";
import {
  organizationMembers,
  organizations,
  teamMembers,
  teams,
  users
} from "../schema";

type AgentMemoryTransaction = Parameters<
  Parameters<AgentMemoryDatabase["transaction"]>[0]
>[0];

async function lockOrganization(
  transaction: AgentMemoryTransaction,
  organizationId: string
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`
  );
}

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
          status: "active",
          createdAt: organization.createdAt
        });
        return { status: "created", organization: created } as const;
      });
    },

    async findOrganization(organizationId) {
      const [organization] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return organization ?? null;
    },

    async updateOrganizationSettings(organizationId, update, now) {
      return db.transaction(async (transaction) => {
        await lockOrganization(transaction, organizationId);
        if (update.defaultTeamId) {
          const [team] = await transaction
            .select({ id: teams.id })
            .from(teams)
            .where(
              and(
                eq(teams.organizationId, organizationId),
                eq(teams.id, update.defaultTeamId)
              )
            )
            .limit(1);
          if (!team) {
            return { status: "team_not_found" } as const;
          }
        }
        const [organization] = await transaction
          .update(organizations)
          .set({
            ...(update.name === undefined ? {} : { name: update.name }),
            ...(update.newMemberStatus === undefined
              ? {}
              : { newMemberStatus: update.newMemberStatus }),
            ...(update.defaultTeamId === undefined
              ? {}
              : { defaultTeamId: update.defaultTeamId }),
            ...(update.ontologyMode === undefined
              ? {}
              : { ontologyMode: update.ontologyMode }),
            ...(update.ontology === undefined
              ? {}
              : { ontology: update.ontology }),
            updatedAt: now
          })
          .where(eq(organizations.id, organizationId))
          .returning();
        if (!organization) {
          return { status: "organization_not_found" } as const;
        }
        return { status: "updated", organization } as const;
      });
    },

    async deleteOrganization(organizationId) {
      const deleted = await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .returning({ id: organizations.id });
      return deleted.length > 0;
    },

    async listOrganizationMembers(organizationId) {
      return db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: organizationMembers.role,
          status: organizationMembers.status,
          createdAt: organizationMembers.createdAt
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId))
        .orderBy(asc(users.name), asc(users.id));
    },

    async findOrganizationMember(organizationId, userId) {
      const [member] = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: organizationMembers.role,
          status: organizationMembers.status,
          createdAt: organizationMembers.createdAt
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId)
          )
        )
        .limit(1);
      return member ?? null;
    },

    async addOrganizationMember(organizationId, email, role) {
      return db.transaction(async (transaction) => {
        const [user] = await transaction
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!user) {
          return { status: "user_not_found" } as const;
        }
        const [saved] = await transaction
          .insert(organizationMembers)
          .values({ organizationId, userId: user.id, role, status: "active" })
          .onConflictDoNothing({
            target: [organizationMembers.organizationId, organizationMembers.userId]
          })
          .returning({
            role: organizationMembers.role,
            status: organizationMembers.status,
            createdAt: organizationMembers.createdAt
          });
        if (!saved) {
          return { status: "already_member" } as const;
        }
        return {
          status: "added",
          member: {
            userId: user.id,
            email: user.email,
            name: user.name,
            ...saved
          }
        } as const;
      });
    },

    async updateOrganizationMember(organizationId, userId, update) {
      return db.transaction(async (transaction) => {
        await lockOrganization(transaction, organizationId);
        const [existing] = await transaction
          .select({
            role: organizationMembers.role,
            status: organizationMembers.status
          })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, userId)
            )
          )
          .limit(1);
        if (!existing) {
          return { status: "member_not_found" } as const;
        }
        const demotesActiveOwner =
          existing.role === "owner" &&
          existing.status === "active" &&
          (update.role !== undefined && update.role !== "owner");
        const deactivatesActiveOwner =
          existing.role === "owner" &&
          existing.status === "active" &&
          update.status !== undefined &&
          update.status !== "active";
        if (demotesActiveOwner || deactivatesActiveOwner) {
          const [owners] = await transaction
            .select({ total: count() })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.role, "owner"),
                eq(organizationMembers.status, "active")
              )
            );
          if (!owners || owners.total <= 1) {
            return { status: "owner_immutable" } as const;
          }
        }

        const [saved] = await transaction
          .update(organizationMembers)
          .set({
            ...(update.role === undefined ? {} : { role: update.role }),
            ...(update.status === undefined ? {} : { status: update.status })
          })
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, userId)
            )
          )
          .returning({
            role: organizationMembers.role,
            status: organizationMembers.status,
            createdAt: organizationMembers.createdAt
          });
        if (!saved) {
          return { status: "member_not_found" } as const;
        }

        const becameActive =
          existing.status !== "active" && saved.status === "active";
        if (becameActive) {
          const [organization] = await transaction
            .select({ defaultTeamId: organizations.defaultTeamId })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1);
          if (organization?.defaultTeamId) {
            await transaction
              .insert(teamMembers)
              .values({
                organizationId,
                teamId: organization.defaultTeamId,
                userId,
                role: "member"
              })
              .onConflictDoNothing({
                target: [teamMembers.teamId, teamMembers.userId]
              });
          }
        }

        const [user] = await transaction
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          return { status: "member_not_found" } as const;
        }
        return {
          status: "saved",
          member: {
            userId: user.id,
            email: user.email,
            name: user.name,
            ...saved
          }
        } as const;
      });
    },

    async removeOrganizationMember(organizationId, userId) {
      return db.transaction(async (transaction) => {
        await lockOrganization(transaction, organizationId);
        const [existing] = await transaction
          .select({
            role: organizationMembers.role,
            status: organizationMembers.status
          })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, userId)
            )
          )
          .limit(1);
        if (!existing) {
          return { status: "member_not_found" } as const;
        }
        if (existing.role === "owner" && existing.status === "active") {
          const [owners] = await transaction
            .select({ total: count() })
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, organizationId),
                eq(organizationMembers.role, "owner"),
                eq(organizationMembers.status, "active")
              )
            );
          if (!owners || owners.total <= 1) {
            return { status: "owner_immutable" } as const;
          }
        }
        await transaction
          .delete(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, userId)
            )
          );
        return { status: "removed" } as const;
      });
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

    async updateTeam(organizationId, teamId, name, now) {
      const [team] = await db
        .update(teams)
        .set({ name, updatedAt: now })
        .where(
          and(eq(teams.organizationId, organizationId), eq(teams.id, teamId))
        )
        .returning();
      return team
        ? { status: "updated", team }
        : { status: "team_not_found" };
    },

    async deleteTeam(organizationId, teamId) {
      return db.transaction(async (transaction) => {
        await lockOrganization(transaction, organizationId);
        await transaction
          .update(organizations)
          .set({ defaultTeamId: null })
          .where(
            and(
              eq(organizations.id, organizationId),
              eq(organizations.defaultTeamId, teamId)
            )
          );
        const deleted = await transaction
          .delete(teams)
          .where(
            and(eq(teams.organizationId, organizationId), eq(teams.id, teamId))
          )
          .returning({ id: teams.id });
        return deleted.length > 0;
      });
    },

    async listTeamMembers(organizationId, teamId) {
      const [team] = await db
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(eq(teams.organizationId, organizationId), eq(teams.id, teamId))
        )
        .limit(1);
      if (!team) {
        return null;
      }
      return db
        .select({
          teamId: teamMembers.teamId,
          userId: users.id,
          email: users.email,
          name: users.name,
          role: teamMembers.role,
          createdAt: teamMembers.createdAt
        })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(
          and(
            eq(teamMembers.organizationId, organizationId),
            eq(teamMembers.teamId, teamId)
          )
        )
        .orderBy(asc(users.name), asc(users.id));
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
    },

    async removeTeamMember(organizationId, teamId, userId) {
      const removed = await db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.organizationId, organizationId),
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId)
          )
        )
        .returning({ userId: teamMembers.userId });
      return removed.length > 0;
    },

    async listJoinableOrganizations(userId) {
      const memberships = db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, userId));
      return db
        .select({
          id: organizations.id,
          slug: organizations.slug,
          name: organizations.name
        })
        .from(organizations)
        .where(notInArray(organizations.id, memberships))
        .orderBy(asc(organizations.name), asc(organizations.id));
    },

    async joinOrganizationBySlug(organizationSlug, userId) {
      return db.transaction(async (transaction) => {
        const [candidate] = await transaction
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, organizationSlug))
          .limit(1);
        if (!candidate) {
          return { status: "organization_not_found" } as const;
        }
        await lockOrganization(transaction, candidate.id);
        const [organization] = await transaction
          .select({
            id: organizations.id,
            newMemberStatus: organizations.newMemberStatus,
            defaultTeamId: organizations.defaultTeamId
          })
          .from(organizations)
          .where(eq(organizations.id, candidate.id))
          .limit(1);
        if (!organization) {
          return { status: "organization_not_found" } as const;
        }
        const [inserted] = await transaction
          .insert(organizationMembers)
          .values({
            organizationId: organization.id,
            userId,
            role: "member",
            status: organization.newMemberStatus
          })
          .onConflictDoNothing({
            target: [
              organizationMembers.organizationId,
              organizationMembers.userId
            ]
          })
          .returning({ status: organizationMembers.status });
        if (!inserted) {
          return { status: "already_member" } as const;
        }
        if (inserted.status === "active" && organization.defaultTeamId) {
          await transaction
            .insert(teamMembers)
            .values({
              organizationId: organization.id,
              teamId: organization.defaultTeamId,
              userId,
              role: "member"
            })
            .onConflictDoNothing({
              target: [teamMembers.teamId, teamMembers.userId]
            });
        }
        return {
          status: "joined",
          membershipStatus: inserted.status
        } as const;
      });
    }
  };
}
