import type { OrganizationAccess } from "./organization-access";

export interface OrganizationAccessRepository {
  findByUser(
    organizationId: string,
    userId: string
  ): Promise<OrganizationAccess | null>;
}
