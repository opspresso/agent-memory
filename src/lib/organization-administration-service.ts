import { randomUUID } from "node:crypto";

import {
  buildCreateOrganization,
  buildCreateTeam,
  buildDeleteOrganization,
  buildDeleteTeam,
  buildGetOrganization,
  buildJoinOrganization,
  buildListJoinableOrganizations,
  buildListOrganizationMembers,
  buildListTeamMembers,
  buildListTeams,
  buildRemoveOrganizationMember,
  buildRemoveTeamMember,
  buildUpdateOrganizationMember,
  buildUpdateOrganizationSettings,
  buildUpdateTeam,
  buildAddOrganizationMember,
  buildUpsertTeamMember
} from "@/application/identity/manage-organization";

import { organizationAdministrationRepository } from "./container";

const createDependencies = {
  clock: () => new Date(),
  generateId: randomUUID,
  repository: organizationAdministrationRepository
};

export const createOrganizationRecord =
  buildCreateOrganization(createDependencies);
export const getOrganizationRecord = buildGetOrganization(
  organizationAdministrationRepository
);
export const updateOrganizationSettingsRecord = buildUpdateOrganizationSettings(
  organizationAdministrationRepository
);
export const deleteOrganizationRecord = buildDeleteOrganization(
  organizationAdministrationRepository
);
export const listOrganizationMemberRecords = buildListOrganizationMembers(
  organizationAdministrationRepository
);
export const addOrganizationMemberRecord = buildAddOrganizationMember(
  organizationAdministrationRepository
);
export const updateOrganizationMemberRecord = buildUpdateOrganizationMember(
  organizationAdministrationRepository
);
export const removeOrganizationMemberRecord = buildRemoveOrganizationMember(
  organizationAdministrationRepository
);
export const createTeamRecord = buildCreateTeam(createDependencies);
export const listTeamRecords = buildListTeams(
  organizationAdministrationRepository
);
export const updateTeamRecord = buildUpdateTeam(
  organizationAdministrationRepository
);
export const deleteTeamRecord = buildDeleteTeam(
  organizationAdministrationRepository
);
export const listTeamMemberRecords = buildListTeamMembers(
  organizationAdministrationRepository
);
export const upsertTeamMemberRecord = buildUpsertTeamMember(
  organizationAdministrationRepository
);
export const removeTeamMemberRecord = buildRemoveTeamMember(
  organizationAdministrationRepository
);
export const listJoinableOrganizationRecords = buildListJoinableOrganizations(
  organizationAdministrationRepository
);
export const joinOrganizationRecord = buildJoinOrganization(
  organizationAdministrationRepository
);
