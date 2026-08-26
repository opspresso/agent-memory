import { randomUUID } from "node:crypto";

import {
  buildCreateOrganization,
  buildCreateTeam,
  buildListOrganizationMembers,
  buildListTeams,
  buildUpsertOrganizationMember,
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
export const listOrganizationMemberRecords = buildListOrganizationMembers(
  organizationAdministrationRepository
);
export const upsertOrganizationMemberRecord = buildUpsertOrganizationMember(
  organizationAdministrationRepository
);
export const createTeamRecord = buildCreateTeam(createDependencies);
export const listTeamRecords = buildListTeams(
  organizationAdministrationRepository
);
export const upsertTeamMemberRecord = buildUpsertTeamMember(
  organizationAdministrationRepository
);
