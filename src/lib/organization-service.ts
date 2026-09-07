import { organizationAccessRepository } from "./container";
import { installationRepository } from "./installation";
import type { SessionUser } from "./session";

export async function listOrganizationMemberships(user: Pick<SessionUser, "id" | "isAdmin">) {
  await installationRepository.enrollUser(user.id, user.isAdmin);
  return organizationAccessRepository.listByUser(user.id);
}
