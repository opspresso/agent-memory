import { and, eq, sql } from "drizzle-orm";

import { installationMembership, type InstallationRepository } from "@/domain/identity/installation";

import type { AgentMemoryDatabase } from "../client";
import { organizations, organizationMembers, teamMembers } from "../schema";

export function createInstallationRepository(db: AgentMemoryDatabase): InstallationRepository {
  async function initialize() {
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`LOCK TABLE organizations IN SHARE ROW EXCLUSIVE MODE`);
      const existing = await transaction.select().from(organizations).limit(2);
      if (existing.length > 1) {
        throw new Error("Agent Memory requires a single organization. Separate existing organizations into independent installations before starting; no data has been changed.");
      }
      if (existing[0]) {
        return existing[0];
      }
      const [created] = await transaction.insert(organizations).values({
        slug: "default",
        name: "Agent Memory"
      }).returning();
      if (!created) {
        throw new Error("installation organization initialization failed");
      }
      return created;
    });
  }

  return {
    initialize,
    async enrollUser(userId, isAdmin) {
      const installation = await initialize();
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${installation.id}, 0))`);
        const [organization] = await transaction.select().from(organizations)
          .where(eq(organizations.id, installation.id));
        if (!organization) {
          throw new Error("installation organization is missing");
        }
        const [existing] = await transaction.select().from(organizationMembers).where(and(
          eq(organizationMembers.organizationId, organization.id),
          eq(organizationMembers.userId, userId)
        ));
        const [owner] = await transaction.select({ userId: organizationMembers.userId })
          .from(organizationMembers).where(and(
            eq(organizationMembers.organizationId, organization.id),
            eq(organizationMembers.role, "owner"),
            eq(organizationMembers.status, "active")
          )).limit(1);
        const membership = installationMembership({
          isAdmin,
          hasOwner: Boolean(owner),
          ...(existing ? { existing } : {})
        });
        if (existing?.role === membership.role && existing.status === membership.status) {
          return;
        }
        await transaction.insert(organizationMembers).values({
          organizationId: organization.id, userId, ...membership
        }).onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.userId],
          set: membership
        });
        if (membership.status === "active" && organization.defaultTeamId) {
          await transaction.insert(teamMembers).values({
            organizationId: organization.id, teamId: organization.defaultTeamId, userId, role: "member"
          }).onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.userId] });
        }
      });
    }
  };
}
