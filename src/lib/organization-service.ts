import { organizationAccessRepository } from "./container";

export function listOrganizationMemberships(userId: string) {
  return organizationAccessRepository.listByUser(userId);
}

export function getOrganizationAccess(organizationId: string, userId: string) {
  return organizationAccessRepository.findByUser(organizationId, userId);
}
