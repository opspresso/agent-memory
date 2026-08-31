export const organizationAgentTokenPrefix = "amt_";

export interface OrganizationAgentToken {
  readonly organizationId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly encryptedToken?: string;
  readonly masked: string;
  readonly createdAt: Date;
}

export interface OrganizationAgentTokenRepository {
  findByOrganizationId(
    organizationId: string
  ): Promise<OrganizationAgentToken | null>;
  findByOrganizationSlug(
    organizationSlug: string
  ): Promise<OrganizationAgentToken | null>;
  save(token: OrganizationAgentToken): Promise<void>;
  delete(organizationId: string): Promise<void>;
}

export interface OrganizationAgentTokenSecret {
  generate(): string;
  hash(value: string): string;
  encrypt(value: string, organizationId: string): string;
  decrypt(value: string, organizationId: string): string;
  matches(value: string, hash: string): boolean;
  mask(value: string): string;
}
