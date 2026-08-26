import type {
  OrganizationAccess,
  OrganizationRole,
  TeamRole
} from "@/domain/identity/organization-access";
import type { OrganizationAdministrationRepository } from "@/domain/identity/organization-administration-repository";
import {
  createOrganization,
  createTeam,
  type Organization,
  type OrganizationMember,
  type Team,
  type TeamMember
} from "@/domain/identity/organization-administration";

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

export function buildUpsertOrganizationMember(
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
    const result = await repository.upsertOrganizationMember(
      access.organizationId,
      email.trim().toLowerCase(),
      role
    );
    if (result.status === "user_not_found") {
      throw new OrganizationMemberNotFoundError();
    }
    if (result.status === "owner_immutable") {
      throw new OrganizationOwnerImmutableError();
    }
    return result.member;
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
