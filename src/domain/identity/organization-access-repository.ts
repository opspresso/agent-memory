import type {
  OrganizationAccess,
  OrganizationMemberStatus
} from "./organization-access";

export interface OrganizationMembership {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: OrganizationAccess["role"];
  readonly status: OrganizationMemberStatus;
}

export interface OrganizationAccessRepository {
  listByUser(userId: string): Promise<readonly OrganizationMembership[]>;
  findByUser(
    organizationId: string,
    userId: string
  ): Promise<OrganizationAccess | null>;
  findBySlug(
    organizationSlug: string,
    userId: string
  ): Promise<OrganizationAccess | null>;
  findByEmail(
    organizationId: string,
    email: string
  ): Promise<OrganizationAccess | null>;
}
