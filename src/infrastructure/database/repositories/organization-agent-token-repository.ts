import { eq } from "drizzle-orm";

import type { OrganizationAgentTokenRepository } from "@/domain/identity/organization-agent-token-repository";

import type { AgentMemoryDatabase } from "../client";
import { organizationAgentTokens, organizations } from "../schema";

function storedToken(
  token: typeof organizationAgentTokens.$inferSelect
) {
  return {
    organizationId: token.organizationId,
    userId: token.userId,
    tokenHash: token.tokenHash,
    ...(token.encryptedToken ? { encryptedToken: token.encryptedToken } : {}),
    masked: token.masked,
    createdAt: token.createdAt
  };
}

export function createOrganizationAgentTokenRepository(
  db: AgentMemoryDatabase
): OrganizationAgentTokenRepository {
  return {
    async findByOrganizationId(organizationId) {
      const [token] = await db
        .select()
        .from(organizationAgentTokens)
        .where(eq(organizationAgentTokens.organizationId, organizationId))
        .limit(1);
      return token ? storedToken(token) : null;
    },

    async findByOrganizationSlug(organizationSlug) {
      const [token] = await db
        .select({
          organizationId: organizationAgentTokens.organizationId,
          userId: organizationAgentTokens.userId,
          tokenHash: organizationAgentTokens.tokenHash,
          encryptedToken: organizationAgentTokens.encryptedToken,
          masked: organizationAgentTokens.masked,
          createdAt: organizationAgentTokens.createdAt
        })
        .from(organizationAgentTokens)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationAgentTokens.organizationId)
        )
        .where(eq(organizations.slug, organizationSlug))
        .limit(1);
      return token ? storedToken(token) : null;
    },

    async save(token) {
      await db
        .insert(organizationAgentTokens)
        .values(token)
        .onConflictDoUpdate({
          target: organizationAgentTokens.organizationId,
          set: {
            userId: token.userId,
            tokenHash: token.tokenHash,
            encryptedToken: token.encryptedToken,
            masked: token.masked,
            createdAt: token.createdAt
          }
        });
    },

    async delete(organizationId) {
      await db
        .delete(organizationAgentTokens)
        .where(eq(organizationAgentTokens.organizationId, organizationId));
    }
  };
}
