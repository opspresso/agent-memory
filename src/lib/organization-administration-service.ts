import { randomUUID } from "node:crypto";

import {
  buildCreateTeam,
  buildDeleteTeam,
  buildGetOrganization,
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

export const getOrganizationRecord = buildGetOrganization(
  organizationAdministrationRepository
);
export const updateOrganizationSettingsRecord = buildUpdateOrganizationSettings(
  createDependencies
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
  createDependencies
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
