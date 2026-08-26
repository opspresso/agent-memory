import type { OrganizationAccess } from "./organization-access";

export interface OrganizationMembership {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: OrganizationAccess["role"];
}

export interface OrganizationAccessRepository {
  listByUser(userId: string): Promise<readonly OrganizationMembership[]>;
  findByUser(
    organizationId: string,
    userId: string
  ): Promise<OrganizationAccess | null>;
}
