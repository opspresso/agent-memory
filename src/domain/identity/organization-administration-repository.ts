import type {
  KnowledgeOntology,
  KnowledgeOntologyMode
} from "../knowledge/knowledge-ontology";
import type {
  NewMemberStatus,
  ManageableOrganizationMemberStatus,
  OrganizationRole,
  TeamRole
} from "./organization-access";
import type {
  Organization,
  OrganizationMember,
  Team,
  TeamMember
} from "./organization-administration";

export interface OrganizationSettingsUpdate {
  readonly name?: string;
  readonly newMemberStatus?: NewMemberStatus;
  readonly defaultTeamId?: string | null;
  readonly ontologyMode?: KnowledgeOntologyMode;
  readonly ontology?: KnowledgeOntology;
}

export type UpdateOrganizationSettingsResult =
  | Readonly<{ status: "updated"; organization: Organization }>
  | Readonly<{ status: "organization_not_found" }>
  | Readonly<{ status: "team_not_found" }>;

export type AddOrganizationMemberResult =
  | Readonly<{ status: "added"; member: OrganizationMember }>
  | Readonly<{ status: "user_not_found" }>
  | Readonly<{ status: "already_member" }>;

export interface OrganizationMemberUpdate {
  readonly role?: OrganizationRole;
  readonly status?: ManageableOrganizationMemberStatus;
}

export type UpdateOrganizationMemberResult =
  | Readonly<{ status: "saved"; member: OrganizationMember }>
  | Readonly<{ status: "member_not_found" }>
  | Readonly<{ status: "owner_immutable" }>;

export type RemoveOrganizationMemberResult =
  | Readonly<{ status: "removed" }>
  | Readonly<{ status: "member_not_found" }>
  | Readonly<{ status: "owner_immutable" }>;

export type CreateTeamResult =
  | Readonly<{ status: "created"; team: Team }>
  | Readonly<{ status: "slug_conflict" }>;

export type UpdateTeamResult =
  | Readonly<{ status: "updated"; team: Team }>
  | Readonly<{ status: "team_not_found" }>;

export type UpsertTeamMemberResult =
  | Readonly<{ status: "saved"; member: TeamMember }>
  | Readonly<{ status: "organization_member_not_found" }>
  | Readonly<{ status: "team_not_found" }>;

export interface OrganizationAdministrationRepository {
  findOrganization(organizationId: string): Promise<Organization | null>;
  updateOrganizationSettings(
    organizationId: string,
    update: OrganizationSettingsUpdate,
    now: Date
  ): Promise<UpdateOrganizationSettingsResult>;
  listOrganizationMembers(
    organizationId: string
  ): Promise<readonly OrganizationMember[]>;
  findOrganizationMember(
    organizationId: string,
    userId: string
  ): Promise<OrganizationMember | null>;
  addOrganizationMember(
    organizationId: string,
    email: string,
    role: OrganizationRole
  ): Promise<AddOrganizationMemberResult>;
  updateOrganizationMember(
    organizationId: string,
    userId: string,
    update: OrganizationMemberUpdate
  ): Promise<UpdateOrganizationMemberResult>;
  removeOrganizationMember(
    organizationId: string,
    userId: string
  ): Promise<RemoveOrganizationMemberResult>;
  createTeam(team: Team): Promise<CreateTeamResult>;
  listTeams(organizationId: string): Promise<readonly Team[]>;
  updateTeam(
    organizationId: string,
    teamId: string,
    name: string,
    now: Date
  ): Promise<UpdateTeamResult>;
  deleteTeam(organizationId: string, teamId: string): Promise<boolean>;
  listTeamMembers(
    organizationId: string,
    teamId: string
  ): Promise<readonly TeamMember[] | null>;
  upsertTeamMember(
    organizationId: string,
    teamId: string,
    email: string,
    role: TeamRole
  ): Promise<UpsertTeamMemberResult>;
  removeTeamMember(
    organizationId: string,
    teamId: string,
    userId: string
  ): Promise<boolean>;
}
