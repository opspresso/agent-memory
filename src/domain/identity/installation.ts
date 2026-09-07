import type { Organization } from "./organization-administration";
import type {
  OrganizationMemberStatus,
  OrganizationRole
} from "./organization-access";

export interface InstallationRepository {
  initialize(): Promise<Organization>;
  enrollUser(userId: string, isAdmin: boolean): Promise<void>;
}

export function installationMembership(input: {
  readonly isAdmin: boolean;
  readonly hasOwner: boolean;
  readonly existing?: {
    readonly role: OrganizationRole;
    readonly status: OrganizationMemberStatus;
  };
}): { readonly role: OrganizationRole; readonly status: OrganizationMemberStatus } {
  if (input.existing?.status === "blocked" || input.existing?.status === "removed") {
    return input.existing;
  }
  if (input.isAdmin && !input.hasOwner) {
    return { role: "owner", status: "active" };
  }
  return input.existing ?? { role: "member", status: "pending" };
}
