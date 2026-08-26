import type { OrganizationRole, TeamRole } from "./organization-access";
import type {
  Organization,
  OrganizationMember,
  Team,
  TeamMember
} from "./organization-administration";

export type CreateOrganizationResult =
  | Readonly<{ status: "created"; organization: Organization }>
  | Readonly<{ status: "slug_conflict" }>;

export type UpsertOrganizationMemberResult =
  | Readonly<{ status: "saved"; member: OrganizationMember }>
  | Readonly<{ status: "user_not_found" }>
  | Readonly<{ status: "owner_immutable" }>;

export type CreateTeamResult =
  | Readonly<{ status: "created"; team: Team }>
  | Readonly<{ status: "slug_conflict" }>;

export type UpsertTeamMemberResult =
  | Readonly<{ status: "saved"; member: TeamMember }>
  | Readonly<{ status: "organization_member_not_found" }>
  | Readonly<{ status: "team_not_found" }>;

export interface OrganizationAdministrationRepository {
  createOrganization(
    organization: Organization,
    ownerUserId: string
  ): Promise<CreateOrganizationResult>;
  listOrganizationMembers(
    organizationId: string
  ): Promise<readonly OrganizationMember[]>;
  upsertOrganizationMember(
    organizationId: string,
    email: string,
    role: OrganizationRole
  ): Promise<UpsertOrganizationMemberResult>;
  createTeam(team: Team): Promise<CreateTeamResult>;
  listTeams(organizationId: string): Promise<readonly Team[]>;
  upsertTeamMember(
    organizationId: string,
    teamId: string,
    email: string,
    role: TeamRole
  ): Promise<UpsertTeamMemberResult>;
}
