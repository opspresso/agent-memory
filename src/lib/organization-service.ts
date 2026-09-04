import { organizationAccessRepository } from "./container";

export function listOrganizationMemberships(userId: string) {
  return organizationAccessRepository.listByUser(userId);
}
