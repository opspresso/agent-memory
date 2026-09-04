import type {
  OrganizationAccess,
  OrganizationMemberStatus,
  OrganizationRole,
  TeamRole
} from "@/domain/identity/organization-access";
import type {
  OrganizationAdministrationRepository,
  OrganizationMemberUpdate,
  OrganizationSettingsUpdate
} from "@/domain/identity/organization-administration-repository";
import {
  createOrganization,
  createTeam,
  normalizedOrganizationName,
  type Organization,
  type OrganizationMember,
  type Team,
  type TeamMember
} from "@/domain/identity/organization-administration";
import { createKnowledgeOntology } from "@/domain/knowledge/knowledge-ontology";

export class OrganizationAdministrationAccessDeniedError extends Error {
  constructor() {
    super("organization administration access denied");
    this.name = "OrganizationAdministrationAccessDeniedError";
  }
}

export class OrganizationSlugConflictError extends Error {
  constructor() {
    super("organization slug already exists");
    this.name = "OrganizationSlugConflictError";
  }
}

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("organization not found");
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationMemberNotFoundError extends Error {
  constructor() {
    super("organization member not found");
    this.name = "OrganizationMemberNotFoundError";
  }
}

export class OrganizationOwnerImmutableError extends Error {
  constructor() {
    super("last organization owner role cannot be changed");
    this.name = "OrganizationOwnerImmutableError";
  }
}

export class OrganizationSelfManagementError extends Error {
  constructor() {
    super("organization members cannot change their own membership");
    this.name = "OrganizationSelfManagementError";
  }
}

export class AlreadyOrganizationMemberError extends Error {
  constructor() {
    super("user already belongs to this organization");
    this.name = "AlreadyOrganizationMemberError";
  }
}

export class TeamSlugConflictError extends Error {
  constructor() {
    super("team slug already exists");
    this.name = "TeamSlugConflictError";
  }
}

export class TeamNotFoundError extends Error {
  constructor() {
    super("team not found");
    this.name = "TeamNotFoundError";
  }
}

interface CreateDependencies {
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly repository: OrganizationAdministrationRepository;
}

function canManageOrganization(access: OrganizationAccess): boolean {
  return access.role === "admin" || access.role === "owner";
}

function canManageTeam(access: OrganizationAccess, teamId: string): boolean {
  return (
    canManageOrganization(access) ||
    access.teams.some(
      (team) => team.teamId === teamId && team.role === "manager"
    )
  );
}

export function buildCreateOrganization(dependencies: CreateDependencies) {
  return async function execute(
    ownerUserId: string,
    slug: string,
    name: string
  ): Promise<Organization> {
    const organization = createOrganization({
      id: dependencies.generateId(),
      slug,
      name,
      now: dependencies.clock()
    });
    const result = await dependencies.repository.createOrganization(
      organization,
      ownerUserId
    );
    if (result.status === "slug_conflict") {
      throw new OrganizationSlugConflictError();
    }
    return result.organization;
  };
}

export function buildGetOrganization(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess
  ): Promise<Organization> {
    const organization = await repository.findOrganization(
      access.organizationId
    );
    if (!organization) {
      throw new OrganizationNotFoundError();
    }
    return organization;
  };
}

export function buildUpdateOrganizationSettings(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    update: OrganizationSettingsUpdate
  ): Promise<Organization> {
    if (!canManageOrganization(access)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const result = await repository.updateOrganizationSettings(
      access.organizationId,
      {
        ...update,
        ...(update.name === undefined
          ? {}
          : { name: normalizedOrganizationName(update.name) }),
        ...(update.ontology === undefined
          ? {}
          : { ontology: createKnowledgeOntology(update.ontology) })
      }
    );
    if (result.status === "organization_not_found") {
      throw new OrganizationNotFoundError();
    }
    if (result.status === "team_not_found") {
      throw new TeamNotFoundError();
    }
    return result.organization;
  };
}

export function buildDeleteOrganization(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(access: OrganizationAccess): Promise<void> {
    if (access.role !== "owner") {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const deleted = await repository.deleteOrganization(access.organizationId);
    if (!deleted) {
      throw new OrganizationNotFoundError();
    }
  };
}

export function buildListOrganizationMembers(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess
  ): Promise<readonly OrganizationMember[]> {
    if (!canManageOrganization(access)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    return repository.listOrganizationMembers(access.organizationId);
  };
}

export function buildAddOrganizationMember(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    email: string,
    role: OrganizationRole
  ): Promise<OrganizationMember> {
    if (
      !canManageOrganization(access) ||
      (role === "owner" && access.role !== "owner")
    ) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const result = await repository.addOrganizationMember(
      access.organizationId,
      email.trim().toLowerCase(),
      role
    );
    if (result.status === "user_not_found") {
      throw new OrganizationMemberNotFoundError();
    }
    if (result.status === "already_member") {
      throw new AlreadyOrganizationMemberError();
    }
    return result.member;
  };
}

export function buildUpdateOrganizationMember(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    userId: string,
    update: OrganizationMemberUpdate
  ): Promise<OrganizationMember> {
    if (!canManageOrganization(access)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    if (userId === access.userId) {
      throw new OrganizationSelfManagementError();
    }
    if (update.role === "owner" && access.role !== "owner") {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const target = await repository.findOrganizationMember(
      access.organizationId,
      userId
    );
    if (!target) {
      throw new OrganizationMemberNotFoundError();
    }
    if (target.role === "owner" && access.role !== "owner") {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const result = await repository.updateOrganizationMember(
      access.organizationId,
      userId,
      update
    );
    if (result.status === "member_not_found") {
      throw new OrganizationMemberNotFoundError();
    }
    if (result.status === "owner_immutable") {
      throw new OrganizationOwnerImmutableError();
    }
    return result.member;
  };
}

export function buildRemoveOrganizationMember(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    userId: string
  ): Promise<void> {
    if (!canManageOrganization(access)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    if (userId === access.userId) {
      throw new OrganizationSelfManagementError();
    }
    const target = await repository.findOrganizationMember(
      access.organizationId,
      userId
    );
    if (!target) {
      throw new OrganizationMemberNotFoundError();
    }
    if (target.role === "owner" && access.role !== "owner") {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const result = await repository.removeOrganizationMember(
      access.organizationId,
      userId
    );
    if (result.status === "member_not_found") {
      throw new OrganizationMemberNotFoundError();
    }
    if (result.status === "owner_immutable") {
      throw new OrganizationOwnerImmutableError();
    }
  };
}

export function buildCreateTeam(dependencies: CreateDependencies) {
  return async function execute(
    access: OrganizationAccess,
    slug: string,
    name: string
  ): Promise<Team> {
    if (!canManageOrganization(access)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const team = createTeam({
      id: dependencies.generateId(),
      organizationId: access.organizationId,
      slug,
      name,
      now: dependencies.clock()
    });
    const result = await dependencies.repository.createTeam(team);
    if (result.status === "slug_conflict") {
      throw new TeamSlugConflictError();
    }
    return result.team;
  };
}

export function buildListTeams(repository: OrganizationAdministrationRepository) {
  return async function execute(
    access: OrganizationAccess
  ): Promise<readonly Team[]> {
    return repository.listTeams(access.organizationId);
  };
}

export function buildUpdateTeam(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    teamId: string,
    name: string
  ): Promise<Team> {
    if (!canManageTeam(access, teamId)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const result = await repository.updateTeam(
      access.organizationId,
      teamId,
      normalizedOrganizationName(name)
    );
    if (result.status === "team_not_found") {
      throw new TeamNotFoundError();
    }
    return result.team;
  };
}

export function buildDeleteTeam(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    teamId: string
  ): Promise<void> {
    if (!canManageOrganization(access)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const deleted = await repository.deleteTeam(access.organizationId, teamId);
    if (!deleted) {
      throw new TeamNotFoundError();
    }
  };
}

export function buildListTeamMembers(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    teamId: string
  ): Promise<readonly TeamMember[]> {
    const isTeamMember = access.teams.some((team) => team.teamId === teamId);
    if (!canManageOrganization(access) && !isTeamMember) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const members = await repository.listTeamMembers(
      access.organizationId,
      teamId
    );
    if (!members) {
      throw new TeamNotFoundError();
    }
    return members;
  };
}

export function buildUpsertTeamMember(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    teamId: string,
    email: string,
    role: TeamRole
  ): Promise<TeamMember> {
    if (!canManageTeam(access, teamId)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const result = await repository.upsertTeamMember(
      access.organizationId,
      teamId,
      email.trim().toLowerCase(),
      role
    );
    if (result.status === "organization_member_not_found") {
      throw new OrganizationMemberNotFoundError();
    }
    if (result.status === "team_not_found") {
      throw new TeamNotFoundError();
    }
    return result.member;
  };
}

export function buildRemoveTeamMember(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    access: OrganizationAccess,
    teamId: string,
    userId: string
  ): Promise<void> {
    if (!canManageTeam(access, teamId)) {
      throw new OrganizationAdministrationAccessDeniedError();
    }
    const removed = await repository.removeTeamMember(
      access.organizationId,
      teamId,
      userId
    );
    if (!removed) {
      throw new OrganizationMemberNotFoundError();
    }
  };
}

export function buildListJoinableOrganizations(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(userId: string) {
    return repository.listJoinableOrganizations(userId);
  };
}

export function buildJoinOrganization(
  repository: OrganizationAdministrationRepository
) {
  return async function execute(
    userId: string,
    organizationSlug: string
  ): Promise<OrganizationMemberStatus> {
    const result = await repository.joinOrganizationBySlug(
      organizationSlug,
      userId
    );
    if (result.status === "organization_not_found") {
      throw new OrganizationNotFoundError();
    }
    if (result.status === "already_member") {
      throw new AlreadyOrganizationMemberError();
    }
    return result.membershipStatus;
  };
}
