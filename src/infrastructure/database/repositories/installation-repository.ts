import { and, eq, sql } from "drizzle-orm";

import { installationMembership, type InstallationRepository } from "@/domain/identity/installation";
import type { Organization } from "@/domain/identity/organization-administration";

import type { AgentMemoryDatabase } from "../client";
import { organizations, organizationMembers, teamMembers } from "../schema";

function assertSingleOrganizationCount(count: number): void {
  if (count > 1) {
    throw new Error("Agent Memory requires a single organization. Separate existing organizations into independent installations before starting; no data has been changed.");
  }
}

export async function assertSingleOrganizationBeforeMigration(db: AgentMemoryDatabase): Promise<void> {
  const table = await db.execute<{ exists: boolean }>(sql`select to_regclass('public.organizations') is not null as exists`);
  if (!table.rows[0]?.exists) {
    return;
  }
  const organizations = await db.execute(sql`select id from public.organizations limit 2`);
  assertSingleOrganizationCount(organizations.rows.length);
}

function singleOrganization(rows: readonly Organization[]): Organization | undefined {
  assertSingleOrganizationCount(rows.length);
  return rows[0];
}

export function createInstallationRepository(db: AgentMemoryDatabase): InstallationRepository {
  async function find() {
    return singleOrganization(await db.select().from(organizations).limit(2));
  }

  async function initialize() {
    const current = await find();
    if (current) {
      return current;
    }
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`LOCK TABLE organizations IN SHARE ROW EXCLUSIVE MODE`);
      const existing = singleOrganization(await transaction.select().from(organizations).limit(2));
      if (existing) {
        return existing;
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
    async get() {
      const organization = await find();
      if (!organization) {
        throw new Error("installation organization is missing");
      }
      return organization;
    },
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
