import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";
import type {
  OrganizationAgentTokenRepository,
  OrganizationAgentTokenSecret
} from "@/domain/identity/organization-agent-token-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

export class OrganizationAgentTokenAccessDeniedError extends Error {
  constructor() {
    super("organization Agent token access denied");
    this.name = "OrganizationAgentTokenAccessDeniedError";
  }
}

export class OrganizationAgentTokenNotFoundError extends Error {
  constructor() {
    super("organization Agent token not found");
    this.name = "OrganizationAgentTokenNotFoundError";
  }
}

export class OrganizationAgentTokenNotRevealableError extends Error {
  constructor() {
    super("organization Agent token cannot be revealed; regenerate it");
    this.name = "OrganizationAgentTokenNotRevealableError";
  }
}

export interface OrganizationAgentTokenStatus {
  readonly configured: boolean;
  readonly masked?: string;
  readonly createdAt?: string;
  readonly revealable?: boolean;
}

export interface OrganizationAgentTokenCredential {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: "admin" | "owner";
}

interface Dependencies {
  readonly accessRepository: OrganizationAccessRepository;
  readonly clock: () => Date;
  readonly repository: OrganizationAgentTokenRepository;
  readonly secret: OrganizationAgentTokenSecret;
}

function canManage(access: OrganizationAccess): boolean {
  return access.role === "admin" || access.role === "owner";
}

function assertCanManage(access: OrganizationAccess): void {
  if (!canManage(access)) {
    throw new OrganizationAgentTokenAccessDeniedError();
  }
}

export function createOrganizationAgentTokenUseCases(
  dependencies: Dependencies
) {
  return {
    async generate(access: OrganizationAccess) {
      assertCanManage(access);
      const token = dependencies.secret.generate();
      const masked = dependencies.secret.mask(token);
      const createdAt = dependencies.clock();
      await dependencies.repository.save({
        organizationId: access.organizationId,
        userId: access.userId,
        tokenHash: dependencies.secret.hash(token),
        encryptedToken: dependencies.secret.encrypt(token, access.organizationId),
        masked,
        createdAt
      });
      return { token, masked, createdAt: createdAt.toISOString() };
    },

    async status(
      access: OrganizationAccess
    ): Promise<OrganizationAgentTokenStatus> {
      assertCanManage(access);
      const stored = await dependencies.repository.findByOrganizationId(
        access.organizationId
      );
      return stored
        ? {
            configured: true,
            masked: stored.masked,
            createdAt: stored.createdAt.toISOString(),
            revealable: stored.encryptedToken !== undefined
          }
        : { configured: false };
    },

    async revoke(access: OrganizationAccess): Promise<void> {
      assertCanManage(access);
      await dependencies.repository.delete(access.organizationId);
    },

    async reveal(access: OrganizationAccess) {
      assertCanManage(access);
      const stored = await dependencies.repository.findByOrganizationId(
        access.organizationId
      );
      if (!stored) {
        throw new OrganizationAgentTokenNotFoundError();
      }
      if (!stored.encryptedToken) {
        throw new OrganizationAgentTokenNotRevealableError();
      }
      try {
        const token = dependencies.secret.decrypt(
          stored.encryptedToken,
          stored.organizationId
        );
        if (!dependencies.secret.matches(token, stored.tokenHash)) {
          throw new OrganizationAgentTokenNotRevealableError();
        }
        return { token, createdAt: stored.createdAt.toISOString() };
      } catch (error) {
        if (error instanceof OrganizationAgentTokenNotRevealableError) {
          throw error;
        }
        throw new OrganizationAgentTokenNotRevealableError();
      }
    },

    async verify(
      organizationSlug: string,
      candidate: string
    ): Promise<OrganizationAgentTokenCredential | null> {
      const stored = await dependencies.repository.findByOrganizationSlug(
        organizationSlug
      );
      if (!stored || !dependencies.secret.matches(candidate, stored.tokenHash)) {
        return null;
      }
      const issuer = await dependencies.accessRepository.findByUser(
        stored.organizationId,
        stored.userId
      );
      return issuer && canManage(issuer)
        ? {
            organizationId: stored.organizationId,
            userId: issuer.userId,
            role: issuer.role as "admin" | "owner"
          }
        : null;
    }
  };
}
